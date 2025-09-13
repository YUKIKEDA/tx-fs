import * as path from 'path';
import * as fs from 'fs/promises';
import { AppContext, Journal } from '../types';
import { fileExists } from '../utils/fs-utils';

/**
 * Performs crash recovery by examining incomplete transactions
 * @param appContext Application context containing managers
 */
export async function recover(appContext: AppContext): Promise<void> {
  const { journalManager, txDir } = appContext;

  try {
    const txIds = await journalManager.listAllTxIds();

    for (const txId of txIds) {
      const journal = await journalManager.read(txId);
      if (!journal) {
        continue; // Skip if journal cannot be read
      }

      const stagingDir = path.join(txDir, 'staging', txId);

      switch (journal.status) {
        case 'IN_PROGRESS':
          // Transaction was not prepared - roll back
          console.log(`Recovery: Rolling back incomplete transaction ${txId}`);
          await rollbackIncompleteTransaction(appContext, txId, stagingDir);
          break;

        case 'PREPARED':
          // Transaction was prepared but not committed - roll forward
          console.log(`Recovery: Rolling forward prepared transaction ${txId}`);
          await rollForwardPreparedTransaction(appContext, journal, stagingDir);
          break;

        case 'COMMITTED':
        case 'ROLLED_BACK':
          // Transaction is complete - clean up
          console.log(`Recovery: Cleaning up completed transaction ${txId}`);
          await cleanupCompletedTransaction(appContext, txId, stagingDir);
          break;
      }
    }
  } catch (error) {
    console.error('Error during recovery process:', error);
    // Continue initialization even if recovery fails
  }
}

/**
 * Rolls back an incomplete transaction
 * @param appContext Application context containing managers
 * @param txId Transaction ID
 * @param stagingDir Staging directory path
 */
async function rollbackIncompleteTransaction(
  appContext: AppContext,
  txId: string,
  stagingDir: string
): Promise<void> {
  const { journalManager } = appContext;

  try {
    // Remove staging directory
    await fs.rm(stagingDir, { recursive: true, force: true });

    // Delete journal
    await journalManager.delete(txId);
  } catch (error) {
    console.warn(`Failed to clean up incomplete transaction ${txId}:`, error);
  }
}

/**
 * Rolls forward a prepared transaction
 * @param appContext Application context containing managers
 * @param journal Journal object containing operations
 * @param stagingDir Staging directory path
 */
async function rollForwardPreparedTransaction(
  appContext: AppContext,
  journal: Journal,
  stagingDir: string
): Promise<void> {
  const { baseDir } = appContext;

  try {
    // Execute all operations from the journal
    for (const op of journal.operations) {
      const sourceStagingPath = (p: string) => path.join(stagingDir, p);
      const finalDestPath = (p: string) => path.join(baseDir, p);

      switch (op.op) {
        case 'WRITE': {
          const dest = finalDestPath(op.path);
          const source = sourceStagingPath(op.path);

          // Check if staging file exists before attempting rename
          if (await fileExists(source)) {
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.rename(source, dest);
          }
          break;
        }
        case 'RM': {
          const dest = finalDestPath(op.path);
          await fs.rm(dest, { recursive: true, force: true });
          break;
        }
        case 'MKDIR': {
          const dest = finalDestPath(op.path);
          try {
            await fs.mkdir(dest, { recursive: true });
          } catch (e: any) {
            if (e.code !== 'EEXIST') {
              throw e;
            }
          }
          break;
        }
        case 'RENAME': {
          const fromPath = finalDestPath(op.from!);
          const toPath = finalDestPath(op.to!);
          if (await fileExists(fromPath)) {
            await fs.mkdir(path.dirname(toPath), { recursive: true });
            await fs.rename(fromPath, toPath);
          }
          break;
        }
        case 'CP': {
          const fromPath = finalDestPath(op.from!);
          const toPath = finalDestPath(op.to!);
          if (await fileExists(fromPath)) {
            await fs.mkdir(path.dirname(toPath), { recursive: true });
            await fs.cp(fromPath, toPath, { recursive: true });
          }
          break;
        }
      }
    }

    // Mark as committed and clean up
    await cleanupCompletedTransaction(appContext, journal.id, stagingDir);
  } catch (error) {
    console.error(`Failed to roll forward transaction ${journal.id}:`, error);
    // Leave the journal for manual inspection
  }
}

/**
 * Cleans up a completed transaction
 * @param appContext Application context containing managers
 * @param txId Transaction ID
 * @param stagingDir Staging directory path
 */
async function cleanupCompletedTransaction(
  appContext: AppContext,
  txId: string,
  stagingDir: string
): Promise<void> {
  const { journalManager } = appContext;

  try {
    // Remove staging directory
    await fs.rm(stagingDir, { recursive: true, force: true });

    // Delete journal
    await journalManager.delete(txId);
  } catch (error) {
    console.warn(`Failed to clean up completed transaction ${txId}:`, error);
  }
}
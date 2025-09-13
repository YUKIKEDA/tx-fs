import * as path from 'path';
import * as fs from 'fs/promises';
import { TxFileManagerOptions, TxFileManager, TxHandle, AppContext } from './types';
import { createLockManager } from './lockManager';
import { createJournalManager } from './journalManager';
import { beginTransaction, commitTransaction, rollbackTransaction } from './transaction';
import { writeFile, readFile, appendFile, rm, mkdir, exists, rename, cp, snapshotDir } from './operations';

/**
 * Performs crash recovery by examining incomplete transactions
 * @param appContext Application context containing managers
 */
async function recover(appContext: AppContext): Promise<void> {
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
  journal: any, 
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
          const fromPath = finalDestPath(op.from);
          const toPath = finalDestPath(op.to);
          if (await fileExists(fromPath)) {
            await fs.mkdir(path.dirname(toPath), { recursive: true });
            await fs.rename(fromPath, toPath);
          }
          break;
        }
        case 'CP': {
          const fromPath = finalDestPath(op.from);
          const toPath = finalDestPath(op.to);
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

/**
 * Helper function to check if a file exists
 * @param filePath File path to check
 * @returns True if file exists, false otherwise
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return false;
    }
    throw e;
  }
}

/**
 * Main factory function for the transactional file management system
 * @param options Configuration options
 * @returns TxFileManager instance
 */
export function createTxFileManager(options: TxFileManagerOptions): TxFileManager {
  const baseDir = path.resolve(options.baseDir);
  const txDir = path.join(baseDir, options.txDirName ?? '.tx');

  // Create application context
  const appContext: AppContext = {
    baseDir,
    txDir,
    lockManager: createLockManager({
      lockDir: path.join(txDir, 'locks'),
      baseDir,
      timeout: options.lockTimeout ?? 10000,
    }),
    journalManager: createJournalManager({
      journalDir: path.join(txDir, 'journal'),
    }),
  };

  let isInitialized = false;

  /**
   * Initialize the library.
   * Creates .tx directory and performs crash recovery.
   * Must be called once before calling run().
   */
  const initialize = async (): Promise<void> => {
    if (isInitialized) return;

    // Create necessary directories
    await fs.mkdir(txDir, { recursive: true });
    await fs.mkdir(path.join(txDir, 'staging'), { recursive: true });
    await fs.mkdir(path.join(txDir, 'journal'), { recursive: true });
    await fs.mkdir(path.join(txDir, 'locks'), { recursive: true });

    // Perform crash recovery
    await recover(appContext);

    isInitialized = true;
  };

  /**
   * Provides a scope for executing transactional operations.
   * @param callback Async function that receives a transaction object
   * @returns Return value of callback
   */
  const run = async <T>(callback: (tx: TxHandle) => Promise<T>): Promise<T> => {
    if (!isInitialized) {
      throw new Error('TxFileManager is not initialized. Call initialize() first.');
    }

    const txState = await beginTransaction(appContext);
    
    // Create transaction handle
    const txHandle: TxHandle = {
      readFile: (filePath: string) => readFile(appContext, txState, filePath),
      writeFile: (filePath: string, data: Buffer | string) => writeFile(appContext, txState, filePath, data),
      appendFile: (filePath: string, data: Buffer | string) => appendFile(appContext, txState, filePath, data),
      rm: (targetPath: string, options?: { recursive?: boolean }) => rm(appContext, txState, targetPath, options),
      mkdir: (dirPath: string, options?: { recursive?: boolean }) => mkdir(appContext, txState, dirPath, options),
      exists: (targetPath: string) => exists(appContext, txState, targetPath),
      rename: (oldPath: string, newPath: string) => rename(appContext, txState, oldPath, newPath),
      cp: (sourcePath: string, destPath: string, options?: { recursive?: boolean }) => cp(appContext, txState, sourcePath, destPath, options),
      snapshotDir: (dirPath: string) => snapshotDir(appContext, txState, dirPath),
    };

    try {
      const result = await callback(txHandle);
      await commitTransaction(appContext, txState);
      return result;
    } catch (error) {
      await rollbackTransaction(appContext, txState);
      throw error;
    }
  };

  return {
    initialize,
    run,
  };
}

// Export types
export type { TxFileManagerOptions, TxFileManager, TxHandle };

// Keep existing sum (do not remove)
export { sum } from './sum.js';

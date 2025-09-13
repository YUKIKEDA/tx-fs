// src/transaction.ts

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AppContext, TxState } from './types';

/**
 * Starts a new transaction.
 * Creates a TxState object, staging directory, and journal.
 * @param appContext Application context containing managers
 * @returns Promise that resolves to the transaction state
 */
export async function beginTransaction(appContext: AppContext): Promise<TxState> {
  const { txDir, journalManager } = appContext;
  const txId = randomUUID();

  const txState: TxState = {
    id: txId,
    stagingDir: path.join(txDir, 'staging', txId),
    journal: {
      id: txId,
      status: 'IN_PROGRESS',
      operations: [],
      snapshots: {},
    },
    acquiredLocks: new Set<string>(),
    temporaryResources: new Set<string>(),
  };

  // Create staging directory
  await fs.mkdir(txState.stagingDir, { recursive: true });
  
  // Write journal in initial state
  await journalManager.write(txState.journal);

  return txState;
}

/**
 * Commits a transaction.
 * Atomically applies changes using two-phase commit (Prepare -> Execute).
 * @param appContext Application context containing managers
 * @param txState Transaction state to commit
 */
export async function commitTransaction(appContext: AppContext, txState: TxState): Promise<void> {
  const { baseDir, journalManager } = appContext;
  
  // --- Phase 1: Prepare ---
  txState.journal.status = 'PREPARED';
  // Update journal with synchronous write for crash safety
  await journalManager.write(txState.journal, { sync: true });

  // --- Phase 2: Execute ---
  try {
    for (const op of txState.journal.operations) {
      const sourceStagingPath = (p: string) => path.join(txState.stagingDir, p);
      const finalDestPath = (p: string) => path.join(baseDir, p);

      switch (op.op) {
        case 'WRITE': {
          const dest = finalDestPath(op.path);
          // Create parent directory in case it doesn't exist
          await fs.mkdir(path.dirname(dest), { recursive: true });
          // rename is an atomic operation
          await fs.rename(sourceStagingPath(op.path), dest);
          break;
        }
        case 'RM': {
          const dest = finalDestPath(op.path);
          await fs.rm(dest, { recursive: true, force: true });
          break;
        }
        case 'MKDIR': {
          const dest = finalDestPath(op.path);
          // Skip if directory already exists
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
          await fs.mkdir(path.dirname(toPath), { recursive: true });
          await fs.rename(fromPath, toPath);
          break;
        }
        case 'CP': {
          const fromPath = finalDestPath(op.from);
          const toPath = finalDestPath(op.to);
          await fs.mkdir(path.dirname(toPath), { recursive: true });
          await fs.cp(fromPath, toPath, { recursive: true });
          break;
        }
      }
    }
  } catch (executeError) {
    // When error occurs in execute phase, recovery is typically handled elsewhere
    // Here we just log the error
    console.error(
      `FATAL: Failed to execute commit for txId "${txState.id}" after PREPARED state. ` +
      `Manual recovery may be needed.`,
      executeError
    );
    // Terminating the process might be the safest option in some cases
    // process.exit(1);
    throw executeError; // Re-throw for now
  }
  
  // --- Cleanup ---
  await cleanup(appContext, txState, 'COMMITTED');
}

/**
 * Rollbacks a transaction.
 * Only removes the staging directory without affecting original files.
 * @param appContext Application context containing managers
 * @param txState Transaction state to rollback
 */
export async function rollbackTransaction(appContext: AppContext, txState: TxState): Promise<void> {
  // Restore snapshots for operations that may have overwritten existing files
  await restoreSnapshots(appContext, txState);

  // Remove temporarily created resources
  for (const resourcePath of txState.temporaryResources) {
    try {
      await fs.rm(resourcePath, { recursive: true, force: true });
    } catch (e) {
      // Ignore deletion failures (may already be deleted)
    }
  }

  await cleanup(appContext, txState, 'ROLLED_BACK');
}

/**
 * Restores snapshots for rollback operations
 * @param appContext Application context containing managers
 * @param txState Transaction state containing snapshots
 */
async function restoreSnapshots(appContext: AppContext, txState: TxState): Promise<void> {
  const { baseDir } = appContext;
  
  for (const [relativePath, snapshotPath] of Object.entries(txState.journal.snapshots)) {
    try {
      const originalPath = path.join(baseDir, relativePath);
      
      // Check if snapshot exists
      try {
        await fs.access(snapshotPath);
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          console.warn(`Snapshot not found for rollback: ${snapshotPath}`);
          continue;
        }
        throw e;
      }
      
      // Restore the snapshot to the original location
      await fs.mkdir(path.dirname(originalPath), { recursive: true });
      await fs.cp(snapshotPath, originalPath, { recursive: true });
      
      console.log(`Restored snapshot: ${relativePath}`);
    } catch (error) {
      console.error(`Failed to restore snapshot for ${relativePath}:`, error);
      // Continue with other snapshots even if one fails
    }
  }
}

/**
 * Common cleanup processing after transaction completion
 * @param appContext Application context containing managers
 * @param txState Transaction state to cleanup
 * @param finalStatus Final status of the transaction
 */
async function cleanup(
  appContext: AppContext,
  txState: TxState,
  finalStatus: 'COMMITTED' | 'ROLLED_BACK'
): Promise<void> {
  const { journalManager, lockManager } = appContext;

  // 1. Release all locks
  await lockManager.releaseAll(txState.acquiredLocks);
  
  // 2. Remove staging directory
  await fs.rm(txState.stagingDir, { recursive: true, force: true });

  // 3. Update journal to final state (for debugging) or delete
  if (finalStatus === 'ROLLED_BACK') {
    // Delete journal immediately on rollback as it's not needed
    await journalManager.delete(txState.id);
  } else {
    // Record final state before deletion on successful commit
    txState.journal.status = finalStatus;
    await journalManager.write(txState.journal);
    await journalManager.delete(txState.id);
  }
}
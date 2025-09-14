// src/transaction.ts

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AppContext, TxState } from '../types';

/**
 * Starts a new transaction.
 * Creates a TxState object, staging directory, and journal.
 * @param appContext Application context containing managers
 * @returns Promise that resolves to the transaction state
 */
export async function beginTransaction(
  appContext: AppContext,
): Promise<TxState> {
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
export async function commitTransaction(
  appContext: AppContext,
  txState: TxState,
): Promise<void> {
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
          const source = sourceStagingPath(op.path);

          // Verify staging file exists before attempting rename
          // Use retry logic for Windows file system timing issues
          for (let attempt = 1; attempt <= 5; attempt++) {
            try {
              await fs.access(source);
              break;
            } catch (e: any) {
              if (e.code === 'ENOENT' && attempt < 5) {
                // Wait progressively longer for file system to settle (Windows timing issue)
                await new Promise((resolve) =>
                  setTimeout(resolve, 50 * Math.pow(2, attempt - 1)),
                );
                continue;
              }
              if (e.code === 'ENOENT') {
                // Add more detailed error information for debugging
                try {
                  const stagingDirContents = await fs.readdir(
                    txState.stagingDir,
                  );
                  throw new Error(
                    `Staging file not found for commit: ${op.path}. Staging dir contains: [${stagingDirContents.join(', ')}]. This indicates a bug in the staging logic or filesystem timing issue.`,
                  );
                } catch (dirError) {
                  throw new Error(
                    `Staging file not found for commit: ${op.path}. Could not read staging directory: ${dirError}. This indicates a bug in the staging logic or filesystem timing issue.`,
                  );
                }
              }
              throw e;
            }
          }

          // Create parent directory in case it doesn't exist
          await fs.mkdir(path.dirname(dest), { recursive: true });
          // Use copy+remove instead of rename to handle Windows EPERM issues
          try {
            await fs.rename(source, dest);
          } catch (e: any) {
            if (e.code === 'EPERM' || e.code === 'EXDEV') {
              // Fallback to copy+remove for permission/cross-device issues
              await fs.cp(source, dest, { recursive: true });
              await fs.rm(source, { recursive: true, force: true });
            } else {
              throw e;
            }
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
          // For rename, we copy from staging to destination and remove original
          const stagingToPath = sourceStagingPath(op.to);
          const finalToPath = finalDestPath(op.to);
          const finalFromPath = finalDestPath(op.from);

          // Verify staging file exists
          try {
            await fs.access(stagingToPath);
          } catch (e: any) {
            if (e.code === 'ENOENT') {
              throw new Error(
                `Staging file not found for rename commit: ${op.to}. This indicates a bug in the staging logic.`,
              );
            }
            throw e;
          }

          await fs.mkdir(path.dirname(finalToPath), { recursive: true });
          // Use copy+remove instead of rename to handle Windows EPERM issues
          try {
            await fs.rename(stagingToPath, finalToPath);
          } catch (e: any) {
            if (e.code === 'EPERM' || e.code === 'EXDEV') {
              // Fallback to copy+remove for permission/cross-device issues
              await fs.cp(stagingToPath, finalToPath, { recursive: true });
              await fs.rm(stagingToPath, { recursive: true, force: true });
            } else {
              throw e;
            }
          }
          // Remove original file/dir if it exists
          try {
            await fs.rm(finalFromPath, { recursive: true, force: true });
          } catch (e: any) {
            // Ignore if source doesn't exist (might have been created in staging only)
            if (e.code !== 'ENOENT') {
              throw e;
            }
          }
          break;
        }
        case 'CP': {
          // For copy, we move from staging to destination
          const stagingToPath = sourceStagingPath(op.to);
          const finalToPath = finalDestPath(op.to);

          // Verify staging file exists
          try {
            await fs.access(stagingToPath);
          } catch (e: any) {
            if (e.code === 'ENOENT') {
              throw new Error(
                `Staging file not found for copy commit: ${op.to}. This indicates a bug in the staging logic.`,
              );
            }
            throw e;
          }

          await fs.mkdir(path.dirname(finalToPath), { recursive: true });
          // Always use copy for CP operations to avoid interfering with other staging files
          // The staging cleanup happens later in the cleanup phase
          await fs.cp(stagingToPath, finalToPath, { recursive: true });
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
      executeError,
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
export async function rollbackTransaction(
  appContext: AppContext,
  txState: TxState,
): Promise<void> {
  // Restore snapshots for operations that may have overwritten existing files
  await restoreSnapshots(appContext, txState);

  // Remove temporarily created resources
  for (const resourcePath of txState.temporaryResources) {
    try {
      await fs.rm(resourcePath, { recursive: true, force: true });
    } catch {
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
async function restoreSnapshots(
  appContext: AppContext,
  txState: TxState,
): Promise<void> {
  const { baseDir } = appContext;

  for (const [relativePath, snapshotPath] of Object.entries(
    txState.journal.snapshots,
  )) {
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
  finalStatus: 'COMMITTED' | 'ROLLED_BACK',
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

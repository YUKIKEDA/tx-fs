import * as fs from 'fs/promises';
import * as path from 'path';
import { AppContext, TxState } from '../types';
import { resolveAndVerifyPath } from '../utils/path-utils';
import { exists } from './exists';

/**
 * Renames/moves a file or directory within a transaction.
 * @param appContext Application context containing managers
 * @param txState Current transaction state
 * @param oldPath Current path of the file/directory
 * @param newPath New path for the file/directory
 */
export async function rename(
  appContext: AppContext,
  txState: TxState,
  oldPath: string,
  newPath: string
): Promise<void> {
  const { baseDir, lockManager, journalManager } = appContext;
  const oldAbsolutePath = resolveAndVerifyPath(baseDir, oldPath);
  const newAbsolutePath = resolveAndVerifyPath(baseDir, newPath);
  const oldRelativePath = path.relative(baseDir, oldAbsolutePath);
  const newRelativePath = path.relative(baseDir, newAbsolutePath);

  // Lock both source and destination parent directories
  const oldParentDir = path.dirname(oldAbsolutePath);
  const newParentDir = path.dirname(newAbsolutePath);

  // Acquire locks in consistent order to prevent deadlocks
  const lockTargets = [oldParentDir, newParentDir].sort();
  for (const lockTarget of lockTargets) {
    if (!txState.acquiredLocks.has(lockTarget)) {
      const createdResource = await lockManager.acquireExclusiveLock(lockTarget);
      txState.acquiredLocks.add(lockTarget);
      if (createdResource) {
        txState.temporaryResources.add(createdResource);
      }
    }
  }

  // Check if source exists (using transaction-aware exists)
  const sourceExists = await exists(appContext, txState, oldPath);
  if (!sourceExists) {
    throw new Error(`Source path does not exist: ${oldPath}`);
  }

  // Create snapshot for rollback if the target already exists
  const targetExists = await exists(appContext, txState, newPath);
  if (targetExists) {
    const snapshotPath = path.join(txState.stagingDir, '_snapshots', newRelativePath);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });

    // Always snapshot the ORIGINAL file, not staging version
    await fs.cp(newAbsolutePath, snapshotPath, { recursive: true });
    txState.journal.snapshots[newRelativePath] = snapshotPath;
  }

  // Copy source to staging area under new name
  const newStagingPath = path.join(txState.stagingDir, newRelativePath);
  await fs.mkdir(path.dirname(newStagingPath), { recursive: true });

  // Check if source is in staging area first
  const oldStagingPath = path.join(txState.stagingDir, oldRelativePath);
  let actualSourcePath = oldAbsolutePath;

  try {
    await fs.access(oldStagingPath);
    actualSourcePath = oldStagingPath; // Use staging version if it exists
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
    // Use original file if not in staging
  }

  await fs.cp(actualSourcePath, newStagingPath, { recursive: true });

  // Journaling
  txState.journal.operations.push({
    op: 'RENAME',
    from: oldRelativePath,
    to: newRelativePath
  });

  await journalManager.write(txState.journal);
}
import * as fs from 'fs/promises';
import * as path from 'path';
import { AppContext, TxState } from '../types';
import { resolveAndVerifyPath } from '../utils/path-utils';
import { exists } from './exists';

/**
 * Copies a file or directory within a transaction.
 * @param appContext Application context containing managers
 * @param txState Current transaction state
 * @param sourcePath Source path to copy from
 * @param destPath Destination path to copy to
 * @param options Copy options
 */
export async function cp(
  appContext: AppContext,
  txState: TxState,
  sourcePath: string,
  destPath: string,
  options?: { recursive?: boolean },
): Promise<void> {
  const { baseDir, lockManager, journalManager } = appContext;
  const sourceAbsolutePath = resolveAndVerifyPath(baseDir, sourcePath);
  const destAbsolutePath = resolveAndVerifyPath(baseDir, destPath);
  const sourceRelativePath = path.relative(baseDir, sourceAbsolutePath);
  const destRelativePath = path.relative(baseDir, destAbsolutePath);

  // Check if source exists FIRST (before any locking, using transaction-aware exists)
  const sourceExists = await exists(appContext, txState, sourcePath);
  if (!sourceExists) {
    throw new Error(`Source path does not exist: ${sourcePath}`);
  }

  // Lock source (for reading) and destination parent (for writing)
  const destParentDir = path.dirname(destAbsolutePath);

  // Acquire shared lock on source
  if (!txState.acquiredLocks.has(sourceAbsolutePath)) {
    const createdResource =
      await lockManager.acquireSharedLock(sourceAbsolutePath);
    txState.acquiredLocks.add(sourceAbsolutePath);
    if (createdResource) {
      txState.temporaryResources.add(createdResource);
    }
  }

  // Acquire exclusive lock on destination parent
  if (!txState.acquiredLocks.has(destParentDir)) {
    const createdResource =
      await lockManager.acquireExclusiveLock(destParentDir);
    txState.acquiredLocks.add(destParentDir);
    if (createdResource) {
      txState.temporaryResources.add(createdResource);
    }
  }

  // Create snapshot for rollback if the target already exists (BEFORE modifying it)
  const targetExists = await exists(appContext, txState, destPath);
  if (targetExists) {
    const snapshotPath = path.join(
      txState.stagingDir,
      '_snapshots',
      destRelativePath,
    );
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });

    // Always snapshot the ORIGINAL file, not staging version
    await fs.cp(destAbsolutePath, snapshotPath, { recursive: true });
    txState.journal.snapshots[destRelativePath] = snapshotPath;
  }

  // Copy to staging area
  const stagingDestPath = path.join(txState.stagingDir, destRelativePath);
  await fs.mkdir(path.dirname(stagingDestPath), { recursive: true });

  // Check if source is in staging area first
  const stagingSourcePath = path.join(txState.stagingDir, sourceRelativePath);
  let actualSourcePath = sourceAbsolutePath;

  try {
    await fs.access(stagingSourcePath);
    actualSourcePath = stagingSourcePath; // Use staging version if it exists
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
    // Use original file if not in staging
  }

  try {
    await fs.cp(actualSourcePath, stagingDestPath, {
      recursive: options?.recursive ?? true,
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }
    throw error;
  }

  // Journaling
  txState.journal.operations.push({
    op: 'CP',
    from: sourceRelativePath,
    to: destRelativePath,
  });

  await journalManager.write(txState.journal);
}

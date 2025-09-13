import * as fs from 'fs/promises';
import * as path from 'path';
import { AppContext, TxState } from '../types';
import { resolveAndVerifyPath } from '../utils/path-utils';
import { fileExists } from '../utils/fs-utils';

/**
 * Creates a snapshot of a directory for backup purposes within a transaction.
 * This operation creates a point-in-time copy that can be used for rollback.
 * @param appContext Application context containing managers
 * @param txState Current transaction state
 * @param dirPath Path to the directory to snapshot
 */
export async function snapshotDir(
  appContext: AppContext,
  txState: TxState,
  dirPath: string
): Promise<void> {
  const { baseDir, lockManager, journalManager } = appContext;
  const absolutePath = resolveAndVerifyPath(baseDir, dirPath);
  const relativePath = path.relative(baseDir, absolutePath);

  // Check if directory exists FIRST (before any locking)
  const dirExists = await fileExists(absolutePath);
  if (!dirExists) {
    throw new Error(`Directory does not exist: ${dirPath}`);
  }

  // Acquire shared lock on the directory
  if (!txState.acquiredLocks.has(absolutePath)) {
    const createdResource = await lockManager.acquireSharedLock(absolutePath);
    txState.acquiredLocks.add(absolutePath);
    if (createdResource) {
      txState.temporaryResources.add(createdResource);
    }
  }

  // Create snapshot in staging area
  const snapshotPath = path.join(txState.stagingDir, '_snapshots', relativePath);
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });

  try {
    await fs.cp(absolutePath, snapshotPath, { recursive: true });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }
    throw error;
  }

  // Record snapshot in journal
  txState.journal.snapshots[relativePath] = snapshotPath;

  await journalManager.write(txState.journal);
}
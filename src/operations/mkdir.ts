import * as fs from 'fs/promises';
import * as path from 'path';
import { AppContext, TxState } from '../types';
import { resolveAndVerifyPath } from '../utils/path-utils';

/**
 * Creates a directory within a transaction.
 * @param appContext Application context containing managers
 * @param txState Current transaction state
 * @param dirPath Path to the directory to create
 * @param options Options for directory creation
 */
export async function mkdir(
  appContext: AppContext,
  txState: TxState,
  dirPath: string,
  options?: { recursive?: boolean },
): Promise<void> {
  const { baseDir, lockManager, journalManager } = appContext;
  const absolutePath = resolveAndVerifyPath(baseDir, dirPath);
  const relativePath = path.relative(baseDir, absolutePath);

  // Lock parent directory (to modify directory structure)
  const parentDir = path.dirname(absolutePath);
  if (!txState.acquiredLocks.has(parentDir)) {
    const createdResource = await lockManager.acquireExclusiveLock(parentDir);
    txState.acquiredLocks.add(parentDir);
    if (createdResource) {
      txState.temporaryResources.add(createdResource);
    }
  }

  // Create directory in staging area
  const stagingPath = path.join(txState.stagingDir, relativePath);
  // Always ensure parent directories exist in staging
  await fs.mkdir(path.dirname(stagingPath), { recursive: true });
  await fs.mkdir(stagingPath, { recursive: options?.recursive ?? false });

  // Journaling
  const existingOpIndex = txState.journal.operations.findIndex(
    (op) => op.op === 'MKDIR' && op.path === relativePath,
  );
  if (existingOpIndex === -1) {
    txState.journal.operations.push({ op: 'MKDIR', path: relativePath });
  }

  await journalManager.write(txState.journal);
}

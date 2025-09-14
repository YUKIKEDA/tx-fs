import * as path from 'path';
import { AppContext, TxState } from '../types';
import { resolveAndVerifyPath } from '../utils/path-utils';

/**
 * Removes a file or directory within a transaction.
 * @param appContext Application context containing managers
 * @param txState Current transaction state
 * @param targetPath Path to the file or directory to remove
 * @param _options Options for removal (currently unused)
 */
export async function rm(
  appContext: AppContext,
  txState: TxState,
  targetPath: string,
  _options?: { recursive?: boolean },
): Promise<void> {
  // Suppress unused parameter warning
  void _options;
  const { baseDir, lockManager, journalManager } = appContext;
  const absolutePath = resolveAndVerifyPath(baseDir, targetPath);
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

  // Journaling (actual deletion happens at commit time)
  const existingOpIndex = txState.journal.operations.findIndex(
    (op) => op.op === 'RM' && op.path === relativePath,
  );
  if (existingOpIndex === -1) {
    txState.journal.operations.push({ op: 'RM', path: relativePath });
  }

  await journalManager.write(txState.journal);
}

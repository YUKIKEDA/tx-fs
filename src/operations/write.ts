import * as fs from 'fs/promises';
import * as path from 'path';
import { AppContext, TxState } from '../types';
import { resolveAndVerifyPath } from '../utils/path-utils';
import { fileExists } from '../utils/fs-utils';

/**
 * Writes to a file within a transaction.
 * (Lock acquisition -> Staging -> Journaling)
 * @param appContext Application context containing managers
 * @param txState Current transaction state
 * @param filePath Path to the file to write
 * @param data Data to write to the file
 */
export async function writeFile(
  appContext: AppContext,
  txState: TxState,
  filePath: string,
  data: Buffer | string,
): Promise<void> {
  const { baseDir, lockManager, journalManager } = appContext;
  const absolutePath = resolveAndVerifyPath(baseDir, filePath);
  const relativePath = path.relative(baseDir, absolutePath);

  // --- 1. Lock target determination and acquisition ---
  // Lock target changes depending on whether the file already exists
  const isExistingFile = await fileExists(absolutePath);
  const lockPath = isExistingFile ? absolutePath : path.dirname(absolutePath);

  if (!txState.acquiredLocks.has(lockPath)) {
    const createdResource = await lockManager.acquireExclusiveLock(lockPath);
    txState.acquiredLocks.add(lockPath); // Record to prevent forgetting to release
    if (createdResource) {
      txState.temporaryResources.add(createdResource);
    }
  }

  // --- 2. Write to staging area ---
  const stagingPath = path.join(txState.stagingDir, relativePath);
  // Create parent directory recursively in case it doesn't exist
  await fs.mkdir(path.dirname(stagingPath), { recursive: true });
  await fs.writeFile(stagingPath, data);

  // --- 3. Journaling ---
  // Overwrite write operations to the same file with the latest one
  // (e.g., tx.writeFile('a', '1'); tx.writeFile('a', '2'); -> only one 'WRITE a' should remain in journal)
  const existingOpIndex = txState.journal.operations.findIndex(
    (op) => op.op === 'WRITE' && op.path === relativePath,
  );
  if (existingOpIndex === -1) {
    txState.journal.operations.push({ op: 'WRITE', path: relativePath });
  }
  // Do nothing if operation already exists (staging content is the latest)

  await journalManager.write(txState.journal);
}

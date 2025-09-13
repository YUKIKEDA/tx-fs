import * as fs from 'fs/promises';
import * as path from 'path';
import { AppContext, TxState } from '../types';
import { resolveAndVerifyPath } from '../utils/path-utils';

/**
 * Reads a file within a transaction.
 * First reads from staging area, then from actual file if not found.
 * @param appContext Application context containing managers
 * @param txState Current transaction state
 * @param filePath Path to the file to read
 * @returns Promise that resolves to the file content as Buffer
 */
export async function readFile(
  appContext: AppContext,
  txState: TxState,
  filePath: string,
  encoding?: BufferEncoding
): Promise<string | Buffer> {
  const { baseDir, lockManager } = appContext;
  const absolutePath = resolveAndVerifyPath(baseDir, filePath);
  const relativePath = path.relative(baseDir, absolutePath);

  // Acquire shared lock
  if (!txState.acquiredLocks.has(absolutePath)) {
    const createdResource = await lockManager.acquireSharedLock(absolutePath);
    txState.acquiredLocks.add(absolutePath);
    if (createdResource) {
      txState.temporaryResources.add(createdResource);
    }
  }

  // First check staging area
  const stagingPath = path.join(txState.stagingDir, relativePath);
  try {
    await fs.access(stagingPath);
    return encoding ? fs.readFile(stagingPath, encoding) : fs.readFile(stagingPath);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      // Read from actual file if not in staging
      return encoding ? fs.readFile(absolutePath, encoding) : fs.readFile(absolutePath);
    }
    throw e;
  }
}
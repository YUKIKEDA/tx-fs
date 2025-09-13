import * as fs from 'fs/promises';
import * as path from 'path';
import { AppContext, TxState } from '../types';
import { resolveAndVerifyPath } from '../utils/path-utils';

/**
 * Checks the existence of a file or directory within a transaction.
 * @param appContext Application context containing managers
 * @param txState Current transaction state
 * @param targetPath Path to the file or directory to check
 * @returns Promise that resolves to true if exists, false otherwise
 */
export async function exists(
  appContext: AppContext,
  txState: TxState,
  targetPath: string
): Promise<boolean> {
  const { baseDir } = appContext;
  const absolutePath = resolveAndVerifyPath(baseDir, targetPath);
  const relativePath = path.relative(baseDir, absolutePath);

  // exists operation doesn't actually acquire locks (read-only with no side effects)
  // Check if file marked for deletion exists in journal
  const isMarkedForDeletion = txState.journal.operations.some(
    op => op.op === 'RM' && op.path === relativePath
  );

  if (isMarkedForDeletion) {
    return false; // Treat as non-existent since it's marked for deletion
  }

  // Check if file was renamed FROM this path (source of rename)
  const wasRenamedFrom = txState.journal.operations.some(
    op => op.op === 'RENAME' && op.from === relativePath
  );

  if (wasRenamedFrom) {
    return false; // Treat as non-existent since it was renamed away
  }

  // Check if file was renamed TO this path (destination of rename)
  const wasRenamedTo = txState.journal.operations.find(
    op => op.op === 'RENAME' && op.to === relativePath
  );

  if (wasRenamedTo) {
    return true; // Treat as existing since it was renamed here
  }

  // Check if file was created via WRITE operation
  const wasWritten = txState.journal.operations.some(
    op => op.op === 'WRITE' && op.path === relativePath
  );

  if (wasWritten) {
    return true; // Treat as existing since it was written
  }

  // Check if file was created via CP operation
  const wasCopiedTo = txState.journal.operations.find(
    op => op.op === 'CP' && op.to === relativePath
  );

  if (wasCopiedTo) {
    return true; // Treat as existing since it was copied here
  }

  // First check staging area (newly created files)
  const stagingPath = path.join(txState.stagingDir, relativePath);
  try {
    await fs.access(stagingPath);
    return true; // Exists in staging
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      // Check actual file if not in staging
      const fileExists = async (filePath: string): Promise<boolean> => {
        try {
          await fs.stat(filePath);
          return true;
        } catch (e: any) {
          if (e.code === 'ENOENT') {
            return false;
          }
          throw e;
        }
      };
      return fileExists(absolutePath);
    }
    throw e;
  }
}
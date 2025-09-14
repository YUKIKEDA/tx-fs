import * as fs from 'fs/promises';
import * as path from 'path';
import { AppContext, TxState } from '../types';
import { resolveAndVerifyPath } from '../utils/path-utils';

/**
 * Appends to a file within a transaction.
 * @param appContext Application context containing managers
 * @param txState Current transaction state
 * @param filePath Path to the file to append to
 * @param data Data to append to the file
 */
export async function appendFile(
  appContext: AppContext,
  txState: TxState,
  filePath: string,
  data: Buffer | string,
): Promise<void> {
  const { baseDir, lockManager, journalManager } = appContext;
  const absolutePath = resolveAndVerifyPath(baseDir, filePath);
  const relativePath = path.relative(baseDir, absolutePath);

  // Acquire exclusive lock
  if (!txState.acquiredLocks.has(absolutePath)) {
    const createdResource =
      await lockManager.acquireExclusiveLock(absolutePath);
    txState.acquiredLocks.add(absolutePath);
    if (createdResource) {
      txState.temporaryResources.add(createdResource);
    }
  }

  // Read current content
  let currentData: Buffer;
  const stagingPath = path.join(txState.stagingDir, relativePath);
  try {
    // First check staging area
    currentData = await fs.readFile(stagingPath);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      try {
        // Read from actual file if not in staging
        currentData = await fs.readFile(absolutePath);
      } catch (e2: any) {
        if (e2.code === 'ENOENT') {
          // Start with empty Buffer if file doesn't exist
          currentData = Buffer.alloc(0);
        } else {
          throw e2;
        }
      }
    } else {
      throw e;
    }
  }

  // Concatenate data
  const newData = Buffer.concat([currentData, Buffer.from(data)]);

  // Write to staging area
  await fs.mkdir(path.dirname(stagingPath), { recursive: true });
  await fs.writeFile(stagingPath, newData);

  // Journaling
  const existingOpIndex = txState.journal.operations.findIndex(
    (op) => op.op === 'WRITE' && op.path === relativePath,
  );
  if (existingOpIndex === -1) {
    txState.journal.operations.push({ op: 'WRITE', path: relativePath });
  }

  await journalManager.write(txState.journal);
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { AppContext, TxState } from './types';

/**
 * Normalizes and validates a file path to an absolute path from baseDir.
 * Prevents writing to paths outside of transaction management.
 * @param baseDir Base directory path
 * @param userPath User-provided path
 * @returns Absolute path resolved from baseDir
 */
function resolveAndVerifyPath(baseDir: string, userPath: string): string {
  const absolutePath = path.resolve(baseDir, userPath);
  if (!absolutePath.startsWith(baseDir)) {
    throw new Error(`Path "${userPath}" is outside of the transaction's base directory.`);
  }
  return absolutePath;
}

/**
 * Checks whether a file exists.
 * Safer than fs.access as it ignores errors.
 * @param filePath Path to the file to check
 * @returns Promise that resolves to true if file exists, false otherwise
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return false;
    }
    throw e;
  }
}

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
  data: Buffer | string
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
    op => op.op === 'WRITE' && op.path === relativePath
  );
  if (existingOpIndex === -1) {
    txState.journal.operations.push({ op: 'WRITE', path: relativePath });
  }
  // Do nothing if operation already exists (staging content is the latest)

  await journalManager.write(txState.journal);
}

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
  filePath: string
): Promise<Buffer> {
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
    return fs.readFile(stagingPath);
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      // Read from actual file if not in staging
      return fs.readFile(absolutePath);
    }
    throw e;
  }
}

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
  data: Buffer | string
): Promise<void> {
  const { baseDir, lockManager, journalManager } = appContext;
  const absolutePath = resolveAndVerifyPath(baseDir, filePath);
  const relativePath = path.relative(baseDir, absolutePath);

  // Acquire exclusive lock
  if (!txState.acquiredLocks.has(absolutePath)) {
    const createdResource = await lockManager.acquireExclusiveLock(absolutePath);
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
    op => op.op === 'WRITE' && op.path === relativePath
  );
  if (existingOpIndex === -1) {
    txState.journal.operations.push({ op: 'WRITE', path: relativePath });
  }

  await journalManager.write(txState.journal);
}

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
  _options?: { recursive?: boolean }
): Promise<void> {
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
    op => op.op === 'RM' && op.path === relativePath
  );
  if (existingOpIndex === -1) {
    txState.journal.operations.push({ op: 'RM', path: relativePath });
  }

  await journalManager.write(txState.journal);
}

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
  options?: { recursive?: boolean }
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
  await fs.mkdir(stagingPath, { recursive: options?.recursive ?? false });

  // Journaling
  const existingOpIndex = txState.journal.operations.findIndex(
    op => op.op === 'MKDIR' && op.path === relativePath
  );
  if (existingOpIndex === -1) {
    txState.journal.operations.push({ op: 'MKDIR', path: relativePath });
  }

  await journalManager.write(txState.journal);
}

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

  // First check staging area (newly created files)
  const stagingPath = path.join(txState.stagingDir, relativePath);
  try {
    await fs.access(stagingPath);
    return true; // Exists in staging
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      // Check actual file if not in staging
      return fileExists(absolutePath);
    }
    throw e;
  }
}

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

  // Check if source exists
  const sourceExists = await fileExists(oldAbsolutePath);
  if (!sourceExists) {
    throw new Error(`Source path does not exist: ${oldPath}`);
  }

  // Create snapshot for rollback if the target already exists
  const targetExists = await fileExists(newAbsolutePath);
  if (targetExists) {
    const snapshotPath = path.join(txState.stagingDir, '_snapshots', newRelativePath);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.cp(newAbsolutePath, snapshotPath, { recursive: true });
    txState.journal.snapshots[newRelativePath] = snapshotPath;
  }

  // Journaling
  txState.journal.operations.push({ 
    op: 'RENAME', 
    from: oldRelativePath, 
    to: newRelativePath 
  });

  await journalManager.write(txState.journal);
}

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
  options?: { recursive?: boolean }
): Promise<void> {
  const { baseDir, lockManager, journalManager } = appContext;
  const sourceAbsolutePath = resolveAndVerifyPath(baseDir, sourcePath);
  const destAbsolutePath = resolveAndVerifyPath(baseDir, destPath);
  const sourceRelativePath = path.relative(baseDir, sourceAbsolutePath);
  const destRelativePath = path.relative(baseDir, destAbsolutePath);

  // Check if source exists FIRST (before any locking)
  const sourceExists = await fileExists(sourceAbsolutePath);
  if (!sourceExists) {
    throw new Error(`Source path does not exist: ${sourcePath}`);
  }

  // Lock source (for reading) and destination parent (for writing)
  const destParentDir = path.dirname(destAbsolutePath);
  
  // Acquire shared lock on source
  if (!txState.acquiredLocks.has(sourceAbsolutePath)) {
    const createdResource = await lockManager.acquireSharedLock(sourceAbsolutePath);
    txState.acquiredLocks.add(sourceAbsolutePath);
    if (createdResource) {
      txState.temporaryResources.add(createdResource);
    }
  }

  // Acquire exclusive lock on destination parent
  if (!txState.acquiredLocks.has(destParentDir)) {
    const createdResource = await lockManager.acquireExclusiveLock(destParentDir);
    txState.acquiredLocks.add(destParentDir);
    if (createdResource) {
      txState.temporaryResources.add(createdResource);
    }
  }

  // Copy to staging area
  const stagingDestPath = path.join(txState.stagingDir, destRelativePath);
  await fs.mkdir(path.dirname(stagingDestPath), { recursive: true });
  
  try {
    await fs.cp(sourceAbsolutePath, stagingDestPath, { 
      recursive: options?.recursive ?? true 
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }
    throw error;
  }

  // Create snapshot for rollback if the target already exists
  const targetExists = await fileExists(destAbsolutePath);
  if (targetExists) {
    const snapshotPath = path.join(txState.stagingDir, '_snapshots', destRelativePath);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.cp(destAbsolutePath, snapshotPath, { recursive: true });
    txState.journal.snapshots[destRelativePath] = snapshotPath;
  }

  // Journaling
  txState.journal.operations.push({ 
    op: 'CP', 
    from: sourceRelativePath, 
    to: destRelativePath 
  });

  await journalManager.write(txState.journal);
}

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
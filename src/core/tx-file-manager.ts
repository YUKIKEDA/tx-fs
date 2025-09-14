import * as path from 'path';
import * as fs from 'fs/promises';
import {
  TxFileManagerOptions,
  TxFileManager,
  TxHandle,
  AppContext,
} from '../types';
import { createLockManager } from './lock-manager';
import { createJournalManager } from './journal-manager';
import {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
} from './transaction';
import {
  writeFile,
  readFile,
  appendFile,
  rm,
  mkdir,
  exists,
  rename,
  cp,
  snapshotDir,
} from '../operations';
import { recover } from './recovery';

/**
 * Main factory function for the transactional file management system
 * @param options Configuration options
 * @returns TxFileManager instance
 */
export function createTxFileManager(
  options: TxFileManagerOptions,
): TxFileManager {
  const baseDir = path.resolve(options.baseDir);
  const txDir = path.join(baseDir, options.txDirName ?? '.tx');

  // Create application context
  const appContext: AppContext = {
    baseDir,
    txDir,
    lockManager: createLockManager({
      lockDir: path.join(txDir, 'locks'),
      baseDir,
      timeout: options.lockTimeout ?? 10000,
    }),
    journalManager: createJournalManager({
      journalDir: path.join(txDir, 'journal'),
    }),
  };

  let isInitialized = false;

  /**
   * Initialize the library.
   * Creates .tx directory and performs crash recovery.
   * Must be called once before calling run().
   */
  const initialize = async (): Promise<void> => {
    if (isInitialized) return;

    // Create necessary directories
    await fs.mkdir(txDir, { recursive: true });
    await fs.mkdir(path.join(txDir, 'staging'), { recursive: true });
    await fs.mkdir(path.join(txDir, 'journal'), { recursive: true });
    await fs.mkdir(path.join(txDir, 'locks'), { recursive: true });

    // Perform crash recovery
    await recover(appContext);

    isInitialized = true;
  };

  /**
   * Provides a scope for executing transactional operations.
   * @param callback Async function that receives a transaction object
   * @returns Return value of callback
   */
  const run = async <T>(callback: (tx: TxHandle) => Promise<T>): Promise<T> => {
    if (!isInitialized) {
      throw new Error(
        'TxFileManager is not initialized. Call initialize() first.',
      );
    }

    const txState = await beginTransaction(appContext);

    // Create transaction handle
    const txHandle: TxHandle = {
      readFile: (filePath: string, encoding?: BufferEncoding) =>
        readFile(appContext, txState, filePath, encoding),
      writeFile: (filePath: string, data: Buffer | string) =>
        writeFile(appContext, txState, filePath, data),
      appendFile: (filePath: string, data: Buffer | string) =>
        appendFile(appContext, txState, filePath, data),
      rm: (targetPath: string, options?: { recursive?: boolean }) =>
        rm(appContext, txState, targetPath, options),
      mkdir: (dirPath: string, options?: { recursive?: boolean }) =>
        mkdir(appContext, txState, dirPath, options),
      exists: (targetPath: string) => exists(appContext, txState, targetPath),
      rename: (oldPath: string, newPath: string) =>
        rename(appContext, txState, oldPath, newPath),
      cp: (
        sourcePath: string,
        destPath: string,
        options?: { recursive?: boolean },
      ) => cp(appContext, txState, sourcePath, destPath, options),
      snapshotDir: (dirPath: string) =>
        snapshotDir(appContext, txState, dirPath),
    };

    try {
      const result = await callback(txHandle);
      await commitTransaction(appContext, txState);
      return result;
    } catch (error) {
      await rollbackTransaction(appContext, txState);
      throw error;
    }
  };

  return {
    initialize,
    run,
  };
}

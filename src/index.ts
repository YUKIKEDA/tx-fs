import * as path from 'path';
import * as fs from 'fs/promises';
import { TxFileManagerOptions, TxFileManager, TxHandle, AppContext } from './types';
import { createLockManager } from './lockManager';
import { createJournalManager } from './journalManager';
import { beginTransaction, commitTransaction, rollbackTransaction } from './transaction';
import { writeFile, readFile, appendFile, rm, mkdir, exists } from './operations';

/**
 * Main factory function for the transactional file management system
 * @param options Configuration options
 * @returns TxFileManager instance
 */
export function createTxFileManager(options: TxFileManagerOptions): TxFileManager {
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

    // TODO: Implement recovery process
    // await recover();

    isInitialized = true;
  };

  /**
   * Provides a scope for executing transactional operations.
   * @param callback Async function that receives a transaction object
   * @returns Return value of callback
   */
  const run = async <T>(callback: (tx: TxHandle) => Promise<T>): Promise<T> => {
    if (!isInitialized) {
      throw new Error('TxFileManager is not initialized. Call initialize() first.');
    }

    const txState = await beginTransaction(appContext);
    
    // Create transaction handle
    const txHandle: TxHandle = {
      readFile: (filePath: string) => readFile(appContext, txState, filePath),
      writeFile: (filePath: string, data: Buffer | string) => writeFile(appContext, txState, filePath, data),
      appendFile: (filePath: string, data: Buffer | string) => appendFile(appContext, txState, filePath, data),
      rm: (targetPath: string, options?: { recursive?: boolean }) => rm(appContext, txState, targetPath, options),
      mkdir: (dirPath: string, options?: { recursive?: boolean }) => mkdir(appContext, txState, dirPath, options),
      exists: (targetPath: string) => exists(appContext, txState, targetPath),
      // TODO: Implement rename, cp, snapshotDirectory
      rename: async (_oldPath: string, _newPath: string) => {
        throw new Error('rename operation is not yet implemented');
      },
      cp: async (_sourcePath: string, _destPath: string, _options?: { recursive?: boolean }) => {
        throw new Error('cp operation is not yet implemented');
      },
      snapshotDirectory: async (_dirPath: string) => {
        throw new Error('snapshotDirectory operation is not yet implemented');
      },
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

// Export types
export type { TxFileManagerOptions, TxFileManager, TxHandle };

// Keep existing sum (do not remove)
export { sum } from './sum.js';

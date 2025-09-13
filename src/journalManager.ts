import * as fs from 'fs/promises';
import * as path from 'path';
import { Journal, JournalManager } from './types';

/**
 * Configuration options for the journal manager
 */
export interface JournalManagerOptions {
  /** Directory path where journal files are stored */
  journalDir: string;
}

/**
 * Factory function that returns an object implementing the JournalManager interface
 * @param options Journal manager configuration options
 * @returns Journal manager instance
 */
export function createJournalManager(options: JournalManagerOptions): JournalManager {
  
  /**
   * Generates a journal file path from a transaction ID
   * @param txId Transaction ID
   * @returns Journal file path
   */
  const getJournalPath = (txId: string): string => {
    return path.join(options.journalDir, `${txId}.json`);
  };

  /**
   * Retry function for file operations with exponential backoff
   * Primarily used for handling Windows permission errors from antivirus/Windows Defender
   */
  const retryWithBackoff = async <T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 100
  ): Promise<T> => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        if (error.code === 'EPERM' && attempt < maxRetries) {
          // Exponential backoff for permission errors (common on Windows due to antivirus)
          const delay = baseDelayMs * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  };

  /**
   * Writes a journal to a file
   * @param journal Journal object to write
   * @param opts.sync If true, attempts synchronous write like fs.sync.writeFile (Node.js fs/promises doesn't have full sync, so uses fd.sync() as substitute)
   */
  const write = async (journal: Journal, opts?: { sync?: boolean }): Promise<void> => {
    const journalPath = getJournalPath(journal.id);
    const data = JSON.stringify(journal, null, 2); // Format for readability

    // Ensure journal directory exists
    await fs.mkdir(options.journalDir, { recursive: true });

    await retryWithBackoff(async () => {
      if (opts?.sync) {
        // Important writes that need to be crash-safe, such as transitions to PREPARED state
        let fileHandle;
        try {
          fileHandle = await fs.open(journalPath, 'w');
          await fileHandle.writeFile(data);
          await fileHandle.sync(); // Ensure synchronization to disk
        } finally {
          await fileHandle?.close();
        }
      } else {
        // Normal asynchronous write
        await fs.writeFile(journalPath, data);
      }
    });
  };
  
  /**
   * Reads a journal file with the specified ID
   * @param txId Transaction ID
   * @returns Read journal object. Returns null if file doesn't exist.
   */
  const read = async (txId: string): Promise<Journal | null> => {
    const journalPath = getJournalPath(txId);
    try {
      const data = await retryWithBackoff(async () => {
        return await fs.readFile(journalPath, 'utf-8');
      });
      return JSON.parse(data) as Journal;
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return null; // Return null if file doesn't exist
      }
      if (e instanceof SyntaxError) {
        // Handle corrupted JSON files gracefully
        console.error(`Error during recovery process: ${e}`);
        return null; // Treat corrupted journals as non-existent
      }
      throw e; // Re-throw other errors
    }
  };

  /**
   * Deletes a journal file with the specified ID
   * @param txId Transaction ID
   */
  const del = async (txId: string): Promise<void> => {
    const journalPath = getJournalPath(txId);
    try {
      await retryWithBackoff(async () => {
        await fs.rm(journalPath, { force: true }); // force: true prevents errors even if file doesn't exist
      });
    } catch (e: any) {
      console.warn(`Failed to delete journal for txId "${txId}":`, e.message);
    }
  };
  
  /**
   * Lists all journal IDs in the journal directory.
   * Used for recovery processing.
   * @returns Array of transaction IDs
   */
  const listAllTxIds = async (): Promise<string[]> => {
    try {
      const files = await fs.readdir(options.journalDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => path.basename(file, '.json'));
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return []; // Return empty array if directory doesn't exist
      }
      throw e;
    }
  };

  // Public API
  return {
    write,
    read,
    delete: del, // Use alias since 'delete' is a reserved word
    listAllTxIds,
  };
}
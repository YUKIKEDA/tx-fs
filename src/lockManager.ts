import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import * as lockfile from 'proper-lockfile';
import { LockManager } from './types';

/**
 * Configuration options for the lock manager
 */
export interface LockManagerOptions {
  /** Directory path where lock files are stored */
  lockDir: string;
  /** Base directory path (reference for relative path calculation) */
  baseDir: string;
  /** Lock acquisition timeout in milliseconds */
  timeout: number;
}

/**
 * Creates a lock manager using proper-lockfile
 * @param options Lock manager configuration options
 * @returns Lock manager instance
 */
export function createLockManager(options: LockManagerOptions): LockManager {
  
  /**
   * Generates a lock file path from a resource path
   * @param resourcePath Resource path to lock
   * @returns Lock file path
   */
  const getLockFilePath = (resourcePath: string): string => {
    // Calculate relative path from baseDir
    const relative = path.relative(options.baseDir, resourcePath);
    // Generate hash from path to avoid collisions and OS limitations
    const hashed = createHash('sha256').update(relative).digest('hex');
    return path.join(options.lockDir, `${hashed}.lock`);
  };

  /**
   * Ensures that the target file or directory exists, creating it if it doesn't
   * @param resourcePath Target resource path
   * @returns Whether it was created and the resource type (file or directory)
   */
  const ensureTargetExists = async (resourcePath: string): Promise<{ created: boolean, type: 'file' | 'dir' }> => {
    try {
      await fs.access(resourcePath);
      return { created: false, type: 'file' }; // Treat as file if it already exists
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        // Determine if it's a file or directory based on whether the path has an extension
        const hasExtension = path.extname(resourcePath) !== '';
        
        if (hasExtension) {
          // For files
          await fs.mkdir(path.dirname(resourcePath), { recursive: true });
          await fs.writeFile(resourcePath, '');
          return { created: true, type: 'file' };
        } else {
          // For directories
          await fs.mkdir(resourcePath, { recursive: true });
          return { created: true, type: 'dir' };
        }
      } else {
        throw e;
      }
    }
  };

  /**
   * Acquires a lock on the specified resource
   * @param resourcePath Resource path to lock
   * @param _isShared Whether it's a shared lock (currently unused, reserved for future extension)
   * @returns Path of the resource created during lock acquisition (if any)
   */
  const acquireLock = async (resourcePath: string, _isShared: boolean): Promise<{ createdResource?: string }> => {
    // Ensure lock directory exists
    await fs.mkdir(options.lockDir, { recursive: true });
    
    // Ensure target file/directory exists
    const targetInfo = await ensureTargetExists(resourcePath);
    
    // Configure proper-lockfile options
    const lockOptions: lockfile.LockOptions = {
      stale: options.timeout * 1.5,
      retries: {
        retries: Math.max(1, Math.floor(options.timeout / 100)),
        minTimeout: 100,
        maxTimeout: 100,
        factor: 1,
      },
      lockfilePath: getLockFilePath(resourcePath),
    };
    
    try {
      await lockfile.lock(resourcePath, lockOptions);
      
      // Return temporarily created resource information on successful lock acquisition
      return {
        createdResource: targetInfo.created ? resourcePath : undefined
      };
    } catch (err: any) {
      // If lock acquisition fails, remove temporarily created files/directories
      if (targetInfo.created) {
        try {
          await fs.rm(resourcePath, { recursive: true, force: true });
        } catch (e) {
          // Ignore deletion failures
        }
      }
      
      // Convert timeout error to a more understandable message
      if (err.code === 'ELOCKED') {
        throw new Error(`Failed to acquire lock on "${resourcePath}" within ${options.timeout}ms.`);
      }
      throw err;
    }
  };

  /**
   * Releases the lock on the specified resource
   * @param resourcePath Resource path to release the lock from
   */
  const release = async (resourcePath: string): Promise<void> => {
    try {
      const lockFilePath = getLockFilePath(resourcePath);
      await lockfile.unlock(resourcePath, { lockfilePath: lockFilePath });
    } catch (e: any) {
      // No problem if lock file doesn't exist
      if (e.code !== 'ENOENT') {
        console.warn(`Failed to release lock on "${resourcePath}":`, e.message);
      }
    }
  };

  // Public API
  return {
    /**
     * Acquires a shared lock
     * @param resourcePath Resource path to lock
     * @returns Path of the resource created during lock acquisition (if any)
     */
    acquireSharedLock: async (resourcePath) => {
      const result = await acquireLock(resourcePath, true);
      return result.createdResource;
    },
    /**
     * Acquires an exclusive lock
     * @param resourcePath Resource path to lock
     * @returns Path of the resource created during lock acquisition (if any)
     */
    acquireExclusiveLock: async (resourcePath) => {
      const result = await acquireLock(resourcePath, false);
      return result.createdResource;
    },
    /**
     * Releases locks on multiple resources at once
     * @param resourcePaths Set of resource paths to release locks from
     */
    releaseAll: async (resourcePaths) => {
      const promises = Array.from(resourcePaths).map(p => release(p));
      await Promise.all(promises);
    },
  };
}
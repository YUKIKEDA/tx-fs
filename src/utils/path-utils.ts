import * as path from 'path';

/**
 * Normalizes and validates a file path to an absolute path from baseDir.
 * Prevents writing to paths outside of transaction management.
 * @param baseDir Base directory path
 * @param userPath User-provided path
 * @returns Absolute path resolved from baseDir
 */
export function resolveAndVerifyPath(baseDir: string, userPath: string): string {
  const absolutePath = path.resolve(baseDir, userPath);
  if (!absolutePath.startsWith(baseDir)) {
    throw new Error(`Path "${userPath}" is outside of the transaction's base directory.`);
  }
  return absolutePath;
}
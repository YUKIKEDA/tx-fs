import * as path from 'path';

/**
 * Normalizes and validates a file path to an absolute path from baseDir.
 * Prevents writing to paths outside of transaction management.
 * @param baseDir Base directory path
 * @param userPath User-provided path
 * @returns Absolute path resolved from baseDir
 */
export function resolveAndVerifyPath(
  baseDir: string,
  userPath: string,
): string {
  // First, check if the user-provided path is an absolute path or UNC path
  // This prevents cross-platform absolute path attacks
  const isAbsolutePath = path.isAbsolute(userPath);
  const isUncPath = userPath.startsWith('\\\\') || userPath.startsWith('//');
  const isWindowsDrivePath = /^[A-Za-z]:[\\/]/.test(userPath);
  
  // Reject absolute paths, UNC paths, and Windows drive paths
  if (isAbsolutePath || isUncPath || isWindowsDrivePath) {
    throw new Error(
      `Path "${userPath}" is outside of the transaction's base directory.`,
    );
  }
  
  // Normalize both paths to ensure consistent comparison
  const normalizedBaseDir = path.resolve(baseDir);
  const absolutePath = path.resolve(baseDir, userPath);
  const normalizedAbsolutePath = path.resolve(absolutePath);
  
  // Check if the resolved path is outside the base directory
  // Use path.relative to get a more reliable check
  const relativePath = path.relative(normalizedBaseDir, normalizedAbsolutePath);
  
  // If the relative path starts with '..', it's outside the base directory
  const isOutside = relativePath.startsWith('..');
  
  if (isOutside) {
    throw new Error(
      `Path "${userPath}" is outside of the transaction's base directory.`,
    );
  }
  
  return absolutePath;
}

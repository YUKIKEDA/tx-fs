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
  // Normalize both paths to ensure consistent comparison
  const normalizedBaseDir = path.resolve(baseDir);
  const absolutePath = path.resolve(baseDir, userPath);
  const normalizedAbsolutePath = path.resolve(absolutePath);
  
  // Check if the resolved path is outside the base directory
  // Use path.relative to get a more reliable check
  const relativePath = path.relative(normalizedBaseDir, normalizedAbsolutePath);
  
  //HACK Debug logging for troubleshooting
  console.log('Path validation debug:', {
    userPath,
    baseDir,
    normalizedBaseDir,
    absolutePath,
    normalizedAbsolutePath,
    relativePath,
    isAbsoluteRelativePath: path.isAbsolute(relativePath),
    startsWithDotDot: relativePath.startsWith('..'),
    platform: process.platform
  });
  
  // If the relative path starts with '..' or is absolute, it's outside the base directory
  const isOutside = relativePath.startsWith('..') || path.isAbsolute(relativePath);
  
  if (isOutside) {
    throw new Error(
      `Path "${userPath}" is outside of the transaction's base directory.`,
    );
  }
  
  return absolutePath;
}

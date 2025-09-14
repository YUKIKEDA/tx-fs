import * as fs from 'fs/promises';

/**
 * Checks whether a file exists.
 * Safer than fs.access as it ignores errors.
 * @param filePath Path to the file to check
 * @returns Promise that resolves to true if file exists, false otherwise
 */
export async function fileExists(filePath: string): Promise<boolean> {
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

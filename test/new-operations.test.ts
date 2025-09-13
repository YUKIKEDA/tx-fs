import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src/index';

describe('tx-fs New Operations Tests', () => {
  const testDir = path.join(__dirname, 'test-new-operations');
  let txManager: ReturnType<typeof createTxFileManager>;

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore if directory doesn't exist
    }

    // Create fresh test directory
    await fs.mkdir(testDir, { recursive: true });

    // Initialize transaction manager
    txManager = createTxFileManager({
      baseDir: testDir,
    });
    await txManager.initialize();
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('rename操作', () => {
    it('ファイルのリネームが正常に動作する', async () => {
      // Create initial file
      await fs.writeFile(path.join(testDir, 'original.txt'), 'test content');

      await txManager.run(async (tx) => {
        await tx.rename('original.txt', 'renamed.txt');
      });

      // Check that file was renamed
      const newContent = await fs.readFile(path.join(testDir, 'renamed.txt'), 'utf-8');
      expect(newContent).toBe('test content');

      // Check that original file no longer exists
      await expect(fs.access(path.join(testDir, 'original.txt'))).rejects.toThrow();
    });

    it('ディレクトリのリネームが正常に動作する', async () => {
      // Create initial directory with file
      await fs.mkdir(path.join(testDir, 'original-dir'));
      await fs.writeFile(path.join(testDir, 'original-dir', 'file.txt'), 'content');

      await txManager.run(async (tx) => {
        await tx.rename('original-dir', 'renamed-dir');
      });

      // Check that directory was renamed
      const newContent = await fs.readFile(path.join(testDir, 'renamed-dir', 'file.txt'), 'utf-8');
      expect(newContent).toBe('content');

      // Check that original directory no longer exists
      await expect(fs.access(path.join(testDir, 'original-dir'))).rejects.toThrow();
    });

    it('既存のターゲットがある場合のリネーム（上書き）を処理する', async () => {
      // Create source and target files
      await fs.writeFile(path.join(testDir, 'source.txt'), 'source content');
      await fs.writeFile(path.join(testDir, 'target.txt'), 'target content');

      await txManager.run(async (tx) => {
        await tx.rename('source.txt', 'target.txt');
      });

      // Check that target now has source content
      const content = await fs.readFile(path.join(testDir, 'target.txt'), 'utf-8');
      expect(content).toBe('source content');

      // Check that source no longer exists
      await expect(fs.access(path.join(testDir, 'source.txt'))).rejects.toThrow();
    });

    it('トランザクション失敗時にリネーム操作をロールバックする', async () => {
      // Create initial file
      await fs.writeFile(path.join(testDir, 'original.txt'), 'test content');

      await expect(txManager.run(async (tx) => {
        await tx.rename('original.txt', 'renamed.txt');
        throw new Error('Force rollback');
      })).rejects.toThrow('Force rollback');

      // Check that original file still exists
      const content = await fs.readFile(path.join(testDir, 'original.txt'), 'utf-8');
      expect(content).toBe('test content');

      // Check that renamed file doesn't exist
      await expect(fs.access(path.join(testDir, 'renamed.txt'))).rejects.toThrow();
    });

    it('存在しないファイルのリネーム時にエラーを投げる', async () => {
      await expect(txManager.run(async (tx) => {
        await tx.rename('nonexistent.txt', 'target.txt');
      })).rejects.toThrow('Source path does not exist');
    });
  });

  describe('cp操作', () => {
    it('ファイルのコピーが正常に動作する', async () => {
      // Create source file
      await fs.writeFile(path.join(testDir, 'source.txt'), 'test content');

      await txManager.run(async (tx) => {
        await tx.cp('source.txt', 'copy.txt');
      });

      // Check that both files exist with same content
      const sourceContent = await fs.readFile(path.join(testDir, 'source.txt'), 'utf-8');
      const copyContent = await fs.readFile(path.join(testDir, 'copy.txt'), 'utf-8');
      
      expect(sourceContent).toBe('test content');
      expect(copyContent).toBe('test content');
    });

    it('ディレクトリを再帰的にコピーする', async () => {
      // Create source directory structure
      await fs.mkdir(path.join(testDir, 'source-dir', 'subdir'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'source-dir', 'file1.txt'), 'content1');
      await fs.writeFile(path.join(testDir, 'source-dir', 'subdir', 'file2.txt'), 'content2');

      await txManager.run(async (tx) => {
        await tx.cp('source-dir', 'copy-dir', { recursive: true });
      });

      // Check that directory structure was copied
      const content1 = await fs.readFile(path.join(testDir, 'copy-dir', 'file1.txt'), 'utf-8');
      const content2 = await fs.readFile(path.join(testDir, 'copy-dir', 'subdir', 'file2.txt'), 'utf-8');
      
      expect(content1).toBe('content1');
      expect(content2).toBe('content2');

      // Check that source still exists
      const sourceContent = await fs.readFile(path.join(testDir, 'source-dir', 'file1.txt'), 'utf-8');
      expect(sourceContent).toBe('content1');
    });

    it('既存のターゲットがある場合のコピー（上書き）を処理する', async () => {
      // Create source and target files
      await fs.writeFile(path.join(testDir, 'source.txt'), 'source content');
      await fs.writeFile(path.join(testDir, 'target.txt'), 'target content');

      await txManager.run(async (tx) => {
        await tx.cp('source.txt', 'target.txt');
      });

      // Check that target now has source content
      const targetContent = await fs.readFile(path.join(testDir, 'target.txt'), 'utf-8');
      expect(targetContent).toBe('source content');

      // Check that source still exists
      const sourceContent = await fs.readFile(path.join(testDir, 'source.txt'), 'utf-8');
      expect(sourceContent).toBe('source content');
    });

    it('トランザクション失敗時にコピー操作をロールバックする', async () => {
      // Create source file
      await fs.writeFile(path.join(testDir, 'source.txt'), 'test content');

      await expect(txManager.run(async (tx) => {
        await tx.cp('source.txt', 'copy.txt');
        throw new Error('Force rollback');
      })).rejects.toThrow('Force rollback');

      // Check that source still exists
      const sourceContent = await fs.readFile(path.join(testDir, 'source.txt'), 'utf-8');
      expect(sourceContent).toBe('test content');

      // Check that copy doesn't exist
      await expect(fs.access(path.join(testDir, 'copy.txt'))).rejects.toThrow();
    });

    it('存在しないファイルのコピー時にエラーを投げる', async () => {
      const uniqueNonExistentFile = `nonexistent-${Date.now()}-${Math.random().toString(36).substring(2)}.txt`;
      
      // Ensure the non-existent file really doesn't exist
      const nonExistentPath = path.join(testDir, uniqueNonExistentFile);
      const exists = await fs.access(nonExistentPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
      
      try {
        await txManager.run(async (tx) => {
          await tx.cp(uniqueNonExistentFile, 'target.txt');
        });
        expect.fail('Expected operation to throw error');
      } catch (error: any) {
        expect(error.message).toContain('Source path does not exist');
      }
    });
  });

  describe('snapshotDir操作', () => {
    it('ディレクトリのスナップショットを作成する', async () => {
      // Create directory structure
      await fs.mkdir(path.join(testDir, 'test-dir', 'subdir'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'test-dir', 'file1.txt'), 'content1');
      await fs.writeFile(path.join(testDir, 'test-dir', 'subdir', 'file2.txt'), 'content2');

      await txManager.run(async (tx) => {
        await tx.snapshotDir('test-dir');
        
        // Modify the directory after snapshot
        await tx.writeFile('test-dir/file1.txt', 'modified content');
        await tx.writeFile('test-dir/new-file.txt', 'new content');
      });

      // The snapshot is internal, so we mainly test that the operation doesn't throw
      // and that the transaction completes successfully
      
      // Verify the directory was modified as expected
      const modifiedContent = await fs.readFile(path.join(testDir, 'test-dir', 'file1.txt'), 'utf-8');
      const newContent = await fs.readFile(path.join(testDir, 'test-dir', 'new-file.txt'), 'utf-8');
      
      expect(modifiedContent).toBe('modified content');
      expect(newContent).toBe('new content');
    });

    it('存在しないディレクトリのスナップショット時にエラーを投げる', async () => {
      const uniqueNonExistentDir = `nonexistent-dir-${Date.now()}-${Math.random().toString(36).substring(2)}`;
      
      // Ensure the non-existent directory really doesn't exist
      const nonExistentPath = path.join(testDir, uniqueNonExistentDir);
      const exists = await fs.access(nonExistentPath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
      
      try {
        await txManager.run(async (tx) => {
          await tx.snapshotDir(uniqueNonExistentDir);
        });
        expect.fail('Expected operation to throw error');
      } catch (error: any) {
        expect(error.message).toContain('Directory does not exist');
      }
    });

    it('ロールバックシナリオでスナップショットを処理する', async () => {
      // Create directory structure
      await fs.mkdir(path.join(testDir, 'test-dir'));
      await fs.writeFile(path.join(testDir, 'test-dir', 'file.txt'), 'original content');

      await expect(txManager.run(async (tx) => {
        // Create snapshot
        await tx.snapshotDir('test-dir');
        
        // Modify after snapshot
        await tx.writeFile('test-dir/file.txt', 'modified content');
        
        // Force rollback
        throw new Error('Force rollback');
      })).rejects.toThrow('Force rollback');

      // Since snapshotDir doesn't automatically restore, we just verify
      // that the operation doesn't break the rollback process
      const content = await fs.readFile(path.join(testDir, 'test-dir', 'file.txt'), 'utf-8');
      expect(content).toBe('original content');
    });
  });
});
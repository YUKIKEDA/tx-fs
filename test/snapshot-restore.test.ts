import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src/index';

describe('tx-fs スナップショット復元テスト', () => {
  const testDir = path.join(__dirname, 'test-snapshot-restore');
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

  describe('スナップショット復元を伴うrename', () => {
    it('上書きリネームがロールバックされた時に元のファイルを復元する', async () => {
      // Create source and target files
      await fs.writeFile(path.join(testDir, 'source.txt'), 'source content');
      await fs.writeFile(path.join(testDir, 'target.txt'), 'original target content');

      await expect(txManager.run(async (tx) => {
        // This will create a snapshot of target.txt before overwriting
        await tx.rename('source.txt', 'target.txt');
        
        // Force rollback
        throw new Error('Force rollback');
      })).rejects.toThrow('Force rollback');

      // Check that target file was restored to original content
      const targetContent = await fs.readFile(path.join(testDir, 'target.txt'), 'utf-8');
      expect(targetContent).toBe('original target content');

      // Check that source file still exists (rename was rolled back)
      const sourceContent = await fs.readFile(path.join(testDir, 'source.txt'), 'utf-8');
      expect(sourceContent).toBe('source content');
    });

    it('上書きリネームがロールバックされた時に元のディレクトリを復元する', async () => {
      // Create source directory
      await fs.mkdir(path.join(testDir, 'source-dir'));
      await fs.writeFile(path.join(testDir, 'source-dir', 'file.txt'), 'source content');

      // Create target directory with different content
      await fs.mkdir(path.join(testDir, 'target-dir'));
      await fs.writeFile(path.join(testDir, 'target-dir', 'file.txt'), 'original target content');
      await fs.writeFile(path.join(testDir, 'target-dir', 'extra.txt'), 'extra content');

      await expect(txManager.run(async (tx) => {
        // This will create a snapshot of target-dir before overwriting
        await tx.rename('source-dir', 'target-dir');
        
        // Force rollback
        throw new Error('Force rollback');
      })).rejects.toThrow('Force rollback');

      // Check that target directory was restored to original content
      const targetContent = await fs.readFile(path.join(testDir, 'target-dir', 'file.txt'), 'utf-8');
      const extraContent = await fs.readFile(path.join(testDir, 'target-dir', 'extra.txt'), 'utf-8');
      
      expect(targetContent).toBe('original target content');
      expect(extraContent).toBe('extra content');

      // Check that source directory still exists (rename was rolled back)
      const sourceContent = await fs.readFile(path.join(testDir, 'source-dir', 'file.txt'), 'utf-8');
      expect(sourceContent).toBe('source content');
    });
  });

  describe('スナップショット復元を伴うcp', () => {
    it('上書きコピーがロールバックされた時に元のファイルを復元する', async () => {
      // Create source and target files
      await fs.writeFile(path.join(testDir, 'source.txt'), 'source content');
      await fs.writeFile(path.join(testDir, 'target.txt'), 'original target content');

      await expect(txManager.run(async (tx) => {
        // This will create a snapshot of target.txt before overwriting
        await tx.cp('source.txt', 'target.txt');
        
        // Force rollback
        throw new Error('Force rollback');
      })).rejects.toThrow('Force rollback');

      // Check that target file was restored to original content
      const targetContent = await fs.readFile(path.join(testDir, 'target.txt'), 'utf-8');
      expect(targetContent).toBe('original target content');

      // Check that source file still exists
      const sourceContent = await fs.readFile(path.join(testDir, 'source.txt'), 'utf-8');
      expect(sourceContent).toBe('source content');
    });

    it('上書きコピーがロールバックされた時に元のディレクトリを復元する', async () => {
      // Create source directory
      await fs.mkdir(path.join(testDir, 'source-dir'));
      await fs.writeFile(path.join(testDir, 'source-dir', 'file.txt'), 'source content');

      // Create target directory with different content
      await fs.mkdir(path.join(testDir, 'target-dir'));
      await fs.writeFile(path.join(testDir, 'target-dir', 'file.txt'), 'original target content');
      await fs.writeFile(path.join(testDir, 'target-dir', 'extra.txt'), 'extra content');

      await expect(txManager.run(async (tx) => {
        // This will create a snapshot of target-dir before overwriting
        await tx.cp('source-dir', 'target-dir', { recursive: true });
        
        // Force rollback
        throw new Error('Force rollback');
      })).rejects.toThrow('Force rollback');

      // Check that target directory was restored to original content
      const targetContent = await fs.readFile(path.join(testDir, 'target-dir', 'file.txt'), 'utf-8');
      const extraContent = await fs.readFile(path.join(testDir, 'target-dir', 'extra.txt'), 'utf-8');
      
      expect(targetContent).toBe('original target content');
      expect(extraContent).toBe('extra content');

      // Check that source directory still exists
      const sourceContent = await fs.readFile(path.join(testDir, 'source-dir', 'file.txt'), 'utf-8');
      expect(sourceContent).toBe('source content');
    });
  });

  describe('単一トランザクション内の複数スナップショット', () => {
    it('ロールバック時に複数の上書きファイルを復元する', async () => {
      // Create multiple target files
      await fs.writeFile(path.join(testDir, 'target1.txt'), 'original content 1');
      await fs.writeFile(path.join(testDir, 'target2.txt'), 'original content 2');
      await fs.writeFile(path.join(testDir, 'source1.txt'), 'source content 1');
      await fs.writeFile(path.join(testDir, 'source2.txt'), 'source content 2');

      await expect(txManager.run(async (tx) => {
        // These operations will create snapshots before overwriting
        await tx.rename('source1.txt', 'target1.txt');
        await tx.cp('source2.txt', 'target2.txt');
        
        // Force rollback
        throw new Error('Force rollback');
      })).rejects.toThrow('Force rollback');

      // Check that both target files were restored
      const target1Content = await fs.readFile(path.join(testDir, 'target1.txt'), 'utf-8');
      const target2Content = await fs.readFile(path.join(testDir, 'target2.txt'), 'utf-8');
      
      expect(target1Content).toBe('original content 1');
      expect(target2Content).toBe('original content 2');

      // Check that source1 still exists (rename was rolled back)
      const source1Content = await fs.readFile(path.join(testDir, 'source1.txt'), 'utf-8');
      expect(source1Content).toBe('source content 1');

      // Check that source2 still exists (copy preserves source)
      const source2Content = await fs.readFile(path.join(testDir, 'source2.txt'), 'utf-8');
      expect(source2Content).toBe('source content 2');
    });
  });

  describe('スナップショット復元のエッジケース', () => {
    it('スナップショットディレクトリが欠落している場合のロールバックを処理する', async () => {
      // Create source and target files
      await fs.writeFile(path.join(testDir, 'source.txt'), 'source content');
      await fs.writeFile(path.join(testDir, 'target.txt'), 'original target content');

      // Start a transaction but manually remove snapshot afterwards
      let txWithManualIntervention = false;
      
      try {
        await txManager.run(async (tx) => {
          await tx.rename('source.txt', 'target.txt');
          
          // Manually remove the snapshot directory to simulate corruption
          const txDir = path.join(testDir, '.tx');
          const stagingDirs = await fs.readdir(path.join(txDir, 'staging'));
          for (const stagingDirName of stagingDirs) {
            const snapshotDir = path.join(txDir, 'staging', stagingDirName, '_snapshots');
            try {
              await fs.rm(snapshotDir, { recursive: true, force: true });
            } catch (e) {
              // Ignore if doesn't exist
            }
          }
          
          txWithManualIntervention = true;
          throw new Error('Force rollback after manual intervention');
        });
      } catch (error: any) {
        expect(error.message).toBe('Force rollback after manual intervention');
        expect(txWithManualIntervention).toBe(true);
      }

      // The rollback should complete without throwing, even though snapshot restore failed
      // In this case, the target file won't be restored, but the transaction should still
      // roll back cleanly

      // Check that source file exists (rename operation was rolled back)
      const sourceExists = await fs.access(path.join(testDir, 'source.txt')).then(() => true).catch(() => false);
      expect(sourceExists).toBe(true);
    });

    it('スナップショットが作成されていない場合のロールバックを処理する', async () => {
      // Create only source file (no target to overwrite)
      await fs.writeFile(path.join(testDir, 'source.txt'), 'source content');

      await expect(txManager.run(async (tx) => {
        // This won't create snapshots since target doesn't exist
        await tx.rename('source.txt', 'target.txt');
        
        // Force rollback
        throw new Error('Force rollback');
      })).rejects.toThrow('Force rollback');

      // Check that source file still exists
      const sourceContent = await fs.readFile(path.join(testDir, 'source.txt'), 'utf-8');
      expect(sourceContent).toBe('source content');

      // Check that target file doesn't exist
      const targetExists = await fs.access(path.join(testDir, 'target.txt')).then(() => true).catch(() => false);
      expect(targetExists).toBe(false);
    });
  });
});
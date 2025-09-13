import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src/index';

describe('tx-fs パフォーマンス・ストレステスト', () => {
  const testDir = path.join(__dirname, 'test-performance');
  let txManager: ReturnType<typeof createTxFileManager>;

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }
    await fs.mkdir(testDir, { recursive: true });
    
    txManager = createTxFileManager({ baseDir: testDir });
    await txManager.initialize();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('大量ファイル操作', () => {
    it('100個のファイル作成を処理する', async () => {
      const startTime = Date.now();
      
      await txManager.run(async (tx) => {
        for (let i = 0; i < 100; i++) {
          await tx.writeFile(`file_${i.toString().padStart(3, '0')}.txt`, `Content of file ${i}`);
        }
      });

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`100ファイル作成時間: ${duration}ms`);
      expect(duration).toBeLessThan(10000); // 10秒以内

      // Verify all files were created
      for (let i = 0; i < 100; i++) {
        const content = await fs.readFile(path.join(testDir, `file_${i.toString().padStart(3, '0')}.txt`), 'utf-8');
        expect(content).toBe(`Content of file ${i}`);
      }
    }, 15000); // 15秒タイムアウト

    it('大量ファイルのコピー操作を処理する', async () => {
      // Setup: Create source files
      await txManager.run(async (tx) => {
        await tx.mkdir('source');
        for (let i = 0; i < 50; i++) {
          await tx.writeFile(`source/file_${i}.txt`, `Source content ${i}`);
        }
      });

      const startTime = Date.now();
      
      await txManager.run(async (tx) => {
        await tx.mkdir('dest');
        for (let i = 0; i < 50; i++) {
          await tx.cp(`source/file_${i}.txt`, `dest/file_${i}.txt`);
        }
      });

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`50ファイルコピー時間: ${duration}ms`);
      expect(duration).toBeLessThan(8000); // 8秒以内

      // Verify copies
      for (let i = 0; i < 50; i++) {
        const content = await fs.readFile(path.join(testDir, `dest/file_${i}.txt`), 'utf-8');
        expect(content).toBe(`Source content ${i}`);
      }
    }, 12000);

    it('階層ディレクトリ構造の作成を処理する', async () => {
      const startTime = Date.now();
      
      await txManager.run(async (tx) => {
        // Create 5-level deep directory structure with files at each level
        let currentPath = '';
        for (let level = 0; level < 5; level++) {
          currentPath = path.join(currentPath, `level_${level}`);
          await tx.mkdir(currentPath, { recursive: true });
          
          // Add 10 files at each level
          for (let file = 0; file < 10; file++) {
            await tx.writeFile(
              path.join(currentPath, `file_${file}.txt`), 
              `Level ${level}, File ${file}`
            );
          }
        }
      });

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`階層構造作成時間: ${duration}ms`);
      expect(duration).toBeLessThan(5000); // 5秒以内

      // Verify deepest file
      const deepFile = path.join(testDir, 'level_0/level_1/level_2/level_3/level_4/file_0.txt');
      const content = await fs.readFile(deepFile, 'utf-8');
      expect(content).toBe('Level 4, File 0');
    }, 8000);
  });

  describe('大容量ファイル処理', () => {
    it('5MBファイルの作成と読み取りを処理する', async () => {
      const largeContent = 'A'.repeat(5 * 1024 * 1024); // 5MB
      const startTime = Date.now();
      
      await txManager.run(async (tx) => {
        await tx.writeFile('large_file.txt', largeContent);
      });

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`5MBファイル作成時間: ${duration}ms`);
      expect(duration).toBeLessThan(5000); // 5秒以内

      // Verify content
      const readContent = await fs.readFile(path.join(testDir, 'large_file.txt'), 'utf-8');
      expect(readContent.length).toBe(5 * 1024 * 1024);
      expect(readContent).toBe(largeContent);
    }, 10000);

    it('複数の大容量ファイルコピーを処理する', async () => {
      // Setup: Create 3 large source files (1MB each)
      const mediumContent = 'B'.repeat(1024 * 1024); // 1MB
      
      await txManager.run(async (tx) => {
        await tx.mkdir('large_source');
        for (let i = 0; i < 3; i++) {
          await tx.writeFile(`large_source/large_${i}.txt`, mediumContent);
        }
      });

      const startTime = Date.now();
      
      await txManager.run(async (tx) => {
        await tx.mkdir('large_dest');
        for (let i = 0; i < 3; i++) {
          await tx.cp(`large_source/large_${i}.txt`, `large_dest/large_${i}.txt`);
        }
      });

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`3×1MBファイルコピー時間: ${duration}ms`);
      expect(duration).toBeLessThan(8000); // 8秒以内

      // Verify copies
      for (let i = 0; i < 3; i++) {
        const copiedContent = await fs.readFile(path.join(testDir, `large_dest/large_${i}.txt`), 'utf-8');
        expect(copiedContent.length).toBe(1024 * 1024);
      }
    }, 12000);
  });

  describe('並行処理性能', () => {
    it('複数の独立したトランザクションを並行実行する', async () => {
      const startTime = Date.now();
      
      const promises = Array.from({ length: 5 }, async (_, index) => {
        return txManager.run(async (tx) => {
          await tx.mkdir(`concurrent_dir_${index}`);
          for (let i = 0; i < 10; i++) {
            await tx.writeFile(
              `concurrent_dir_${index}/file_${i}.txt`, 
              `Concurrent content ${index}-${i}`
            );
          }
        });
      });

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`5個並行トランザクション時間: ${duration}ms`);
      expect(duration).toBeLessThan(8000); // 8秒以内

      // Verify all files were created
      for (let dirIndex = 0; dirIndex < 5; dirIndex++) {
        for (let fileIndex = 0; fileIndex < 10; fileIndex++) {
          const filePath = path.join(testDir, `concurrent_dir_${dirIndex}/file_${fileIndex}.txt`);
          const content = await fs.readFile(filePath, 'utf-8');
          expect(content).toBe(`Concurrent content ${dirIndex}-${fileIndex}`);
        }
      }
    }, 12000);

    it('同一ディレクトリへの競合アクセスを処理する', async () => {
      await txManager.run(async (tx) => {
        await tx.mkdir('shared_dir');
      });

      const startTime = Date.now();
      
      const promises = Array.from({ length: 3 }, async (_, index) => {
        return txManager.run(async (tx) => {
          for (let i = 0; i < 5; i++) {
            await tx.writeFile(
              `shared_dir/file_${index}_${i}.txt`, 
              `Shared content ${index}-${i}`
            );
          }
        });
      });

      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`競合アクセス処理時間: ${duration}ms`);
      expect(duration).toBeLessThan(10000); // 10秒以内

      // Verify all files were created
      const files = await fs.readdir(path.join(testDir, 'shared_dir'));
      expect(files.length).toBe(15); // 3 * 5 files
    }, 15000);
  });

  describe('メモリ効率テスト', () => {
    it('大量ファイル操作でのメモリ使用量を監視する', async () => {
      const initialMemory = process.memoryUsage();
      
      await txManager.run(async (tx) => {
        // Create many small files
        for (let i = 0; i < 200; i++) {
          await tx.writeFile(`memory_test_${i}.txt`, `Content ${i}`.repeat(100));
        }
      });

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      console.log(`メモリ使用量増加: ${Math.round(memoryIncrease / 1024 / 1024)}MB`);
      
      // Memory increase should be reasonable (less than 100MB for this test)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    }, 15000);

    it('大容量ファイル処理でのメモリ効率を確認する', async () => {
      const initialMemory = process.memoryUsage();
      
      // Create and process a 10MB file
      const largeContent = 'X'.repeat(10 * 1024 * 1024);
      
      await txManager.run(async (tx) => {
        await tx.writeFile('memory_large.txt', largeContent);
        await tx.cp('memory_large.txt', 'memory_large_copy.txt');
      });

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      console.log(`大容量ファイル処理メモリ増加: ${Math.round(memoryIncrease / 1024 / 1024)}MB`);
      
      // Memory should not grow excessively (less than 3x file size)
      expect(memoryIncrease).toBeLessThan(30 * 1024 * 1024);
    }, 12000);
  });

  describe('操作時間ベンチマーク', () => {
    it('基本操作の時間を測定する', async () => {
      const operations = {
        writeFile: 0,
        readFile: 0,
        mkdir: 0,
        rm: 0,
        cp: 0,
        rename: 0,
        exists: 0
      };

      // Setup some files
      await txManager.run(async (tx) => {
        await tx.writeFile('benchmark_source.txt', 'benchmark content');
        await tx.mkdir('benchmark_dir');
      });

      await txManager.run(async (tx) => {
        // Measure writeFile
        let start = Date.now();
        await tx.writeFile('benchmark_write.txt', 'write content');
        operations.writeFile = Date.now() - start;

        // Measure readFile
        start = Date.now();
        await tx.readFile('benchmark_source.txt', 'utf-8');
        operations.readFile = Date.now() - start;

        // Measure mkdir
        start = Date.now();
        await tx.mkdir('benchmark_new_dir');
        operations.mkdir = Date.now() - start;

        // Measure cp
        start = Date.now();
        await tx.cp('benchmark_source.txt', 'benchmark_copy.txt');
        operations.cp = Date.now() - start;

        // Measure rename
        start = Date.now();
        await tx.rename('benchmark_copy.txt', 'benchmark_renamed.txt');
        operations.rename = Date.now() - start;

        // Measure exists
        start = Date.now();
        await tx.exists('benchmark_renamed.txt');
        operations.exists = Date.now() - start;

        // Measure rm
        start = Date.now();
        await tx.rm('benchmark_renamed.txt');
        operations.rm = Date.now() - start;
      });

      console.log('操作時間ベンチマーク:', operations);

      // Ensure all operations complete in reasonable time
      Object.values(operations).forEach(time => {
        expect(time).toBeLessThan(1000); // Less than 1 second each
      });
    }, 10000);
  });

  describe('スケーラビリティテスト', () => {
    it('ディレクトリ内の大量ファイルを処理する', async () => {
      const fileCount = 300;
      const startTime = Date.now();
      
      await txManager.run(async (tx) => {
        await tx.mkdir('scalability_test');
        
        // Create many files in same directory
        for (let i = 0; i < fileCount; i++) {
          await tx.writeFile(
            `scalability_test/file_${i.toString().padStart(4, '0')}.txt`,
            `Scalability test file ${i}`
          );
        }
      });

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`${fileCount}ファイル作成時間: ${duration}ms`);
      console.log(`1ファイルあたり平均時間: ${(duration / fileCount).toFixed(2)}ms`);
      
      expect(duration).toBeLessThan(15000); // 15秒以内
      expect(duration / fileCount).toBeLessThan(50); // 1ファイルあたり50ms以内

      // Verify random files
      const randomIndices = [0, Math.floor(fileCount / 2), fileCount - 1];
      for (const index of randomIndices) {
        const content = await fs.readFile(
          path.join(testDir, `scalability_test/file_${index.toString().padStart(4, '0')}.txt`),
          'utf-8'
        );
        expect(content).toBe(`Scalability test file ${index}`);
      }
    }, 20000);
  });
});
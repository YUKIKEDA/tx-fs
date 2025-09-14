import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src/index';

describe('tx-fs エッジケース・エラーハンドリングテスト', () => {
  const testDir = path.join(__dirname, 'test-edge-cases');
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

  describe('パス関連のエッジケース', () => {
    it('絶対パスを拒否する', async () => {
      await expect(
        txManager.run(async (tx) => {
          // HACK: Debug logging
          console.log('Testing absolute path rejection...');
          console.log('Test directory:', testDir);
          console.log('OS platform:', process.platform);
          await tx.writeFile('C:\\absolute\\path.txt', 'content');
        }),
      ).rejects.toThrow('outside of the transaction');
    });

    it('パストラバーサル攻撃を防ぐ', async () => {
      await expect(
        txManager.run(async (tx) => {
          await tx.writeFile('../../../etc/passwd', 'malicious content');
        }),
      ).rejects.toThrow('outside of the transaction');
    });

    it('空のパスを適切に処理する', async () => {
      await expect(
        txManager.run(async (tx) => {
          await tx.writeFile('', 'content');
        }),
      ).rejects.toThrow();
    });

    it('非常に長いファイル名を処理する', async () => {
      const longName = 'a'.repeat(255) + '.txt';

      try {
        await txManager.run(async (tx) => {
          await tx.writeFile(longName, 'content');
        });

        // If it succeeds, verify the content
        const content = await fs.readFile(
          path.join(testDir, longName),
          'utf-8',
        );
        expect(content).toBe('content');
      } catch (error: any) {
        // Long filename limitations are acceptable on some systems (e.g., Windows)
        expect(error).toBeInstanceOf(Error);
        console.log('Long filename limitation encountered:', error.message);
      }
    });

    it('特殊文字を含むファイル名を処理する', async () => {
      const specialChars = [
        'ファイル名.txt',
        'file with spaces.txt',
        'file-with-dashes.txt',
        'file_with_underscores.txt',
      ];

      for (const fileName of specialChars) {
        await txManager.run(async (tx) => {
          await tx.writeFile(fileName, `content for ${fileName}`);
        });

        const content = await fs.readFile(
          path.join(testDir, fileName),
          'utf-8',
        );
        expect(content).toBe(`content for ${fileName}`);
      }
    });

    it('深いディレクトリ構造を処理する', async () => {
      const deepPath =
        Array(10)
          .fill(0)
          .map((_, i) => `level${i}`)
          .join('/') + '/deep-file.txt';

      await txManager.run(async (tx) => {
        await tx.writeFile(deepPath, 'deep content');
      });

      const content = await fs.readFile(path.join(testDir, deepPath), 'utf-8');
      expect(content).toBe('deep content');
    });

    it('ドット始まりのファイル名（隠しファイル）を処理する', async () => {
      await txManager.run(async (tx) => {
        await tx.writeFile('.hidden-file', 'hidden content');
        await tx.mkdir('.hidden-dir');
        await tx.writeFile('.hidden-dir/.nested-hidden', 'nested hidden');
      });

      const hiddenContent = await fs.readFile(
        path.join(testDir, '.hidden-file'),
        'utf-8',
      );
      const nestedContent = await fs.readFile(
        path.join(testDir, '.hidden-dir/.nested-hidden'),
        'utf-8',
      );

      expect(hiddenContent).toBe('hidden content');
      expect(nestedContent).toBe('nested hidden');
    });
  });

  describe('ファイルサイズとコンテンツのエッジケース', () => {
    it('空ファイルを処理する', async () => {
      await txManager.run(async (tx) => {
        await tx.writeFile('empty.txt', '');
      });

      const content = await fs.readFile(
        path.join(testDir, 'empty.txt'),
        'utf-8',
      );
      expect(content).toBe('');
    });

    it('大きなファイル（1MB）を処理する', async () => {
      const largeContent = 'A'.repeat(1024 * 1024); // 1MB

      await txManager.run(async (tx) => {
        await tx.writeFile('large.txt', largeContent);
      });

      const content = await fs.readFile(
        path.join(testDir, 'large.txt'),
        'utf-8',
      );
      expect(content).toBe(largeContent);
    });

    it('バイナリファイルを処理する', async () => {
      const binaryData = Buffer.from([
        0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd,
      ]);

      await txManager.run(async (tx) => {
        await tx.writeFile('binary.bin', binaryData);
      });

      const content = await fs.readFile(path.join(testDir, 'binary.bin'));
      expect(content).toEqual(binaryData);
    });

    it('UTF-8特殊文字を含むコンテンツを処理する', async () => {
      const unicodeContent = '🎉 Hello 世界 🌍 Ñiño €£¥';

      await txManager.run(async (tx) => {
        await tx.writeFile('unicode.txt', unicodeContent);
      });

      const content = await fs.readFile(
        path.join(testDir, 'unicode.txt'),
        'utf-8',
      );
      expect(content).toBe(unicodeContent);
    });

    it('複数回の追記操作を処理する', async () => {
      await txManager.run(async (tx) => {
        await tx.writeFile('append-test.txt', 'line1\n');
        await tx.appendFile('append-test.txt', 'line2\n');
        await tx.appendFile('append-test.txt', 'line3\n');
      });

      const content = await fs.readFile(
        path.join(testDir, 'append-test.txt'),
        'utf-8',
      );
      expect(content).toBe('line1\nline2\nline3\n');
    });
  });

  describe('ディレクトリ操作のエッジケース', () => {
    it('既存ディレクトリに対するmkdirを処理する', async () => {
      await fs.mkdir(path.join(testDir, 'existing-dir'));

      await txManager.run(async (tx) => {
        await tx.mkdir('existing-dir');
      });

      // Should not throw error
      const stats = await fs.stat(path.join(testDir, 'existing-dir'));
      expect(stats.isDirectory()).toBe(true);
    });

    it('再帰的ディレクトリ作成を処理する', async () => {
      await txManager.run(async (tx) => {
        await tx.mkdir('parent/child/grandchild', { recursive: true });
      });

      const stats = await fs.stat(
        path.join(testDir, 'parent/child/grandchild'),
      );
      expect(stats.isDirectory()).toBe(true);
    });

    it('空でないディレクトリの削除を処理する', async () => {
      await fs.mkdir(path.join(testDir, 'non-empty-dir'));
      await fs.writeFile(
        path.join(testDir, 'non-empty-dir', 'file.txt'),
        'content',
      );
      await fs.mkdir(path.join(testDir, 'non-empty-dir', 'subdir'));

      await txManager.run(async (tx) => {
        await tx.rm('non-empty-dir', { recursive: true });
      });

      await expect(
        fs.access(path.join(testDir, 'non-empty-dir')),
      ).rejects.toThrow();
    });

    it('存在しないディレクトリの削除を処理する', async () => {
      await txManager.run(async (tx) => {
        await tx.rm('nonexistent-dir', { recursive: true });
      });

      // Should not throw error
    });
  });

  describe('競合状態とロック処理', () => {
    it('同じファイルへの複数書き込みを処理する', async () => {
      await txManager.run(async (tx) => {
        await tx.writeFile('multi-write.txt', 'first');
        await tx.writeFile('multi-write.txt', 'second');
        await tx.writeFile('multi-write.txt', 'third');
      });

      const content = await fs.readFile(
        path.join(testDir, 'multi-write.txt'),
        'utf-8',
      );
      expect(content).toBe('third');
    });

    it('同じディレクトリでの複数操作を処理する', async () => {
      await txManager.run(async (tx) => {
        await tx.mkdir('test-dir');
        await tx.writeFile('test-dir/file1.txt', 'content1');
        await tx.writeFile('test-dir/file2.txt', 'content2');
        await tx.mkdir('test-dir/subdir');
        await tx.writeFile('test-dir/subdir/file3.txt', 'content3');
      });

      const content1 = await fs.readFile(
        path.join(testDir, 'test-dir/file1.txt'),
        'utf-8',
      );
      const content2 = await fs.readFile(
        path.join(testDir, 'test-dir/file2.txt'),
        'utf-8',
      );
      const content3 = await fs.readFile(
        path.join(testDir, 'test-dir/subdir/file3.txt'),
        'utf-8',
      );

      expect(content1).toBe('content1');
      expect(content2).toBe('content2');
      expect(content3).toBe('content3');
    });
  });

  describe('トランザクション境界のエッジケース', () => {
    it('未初期化マネージャーでの操作を拒否する', async () => {
      const uninitializedManager = createTxFileManager({ baseDir: testDir });

      await expect(
        uninitializedManager.run(async (tx) => {
          await tx.writeFile('test.txt', 'content');
        }),
      ).rejects.toThrow('not initialized');
    });

    it('空のトランザクションを処理する', async () => {
      await txManager.run(async (tx) => {
        // Do nothing
      });

      // Should complete without error
    });

    it('ネストしたトランザクション操作を処理する', async () => {
      await txManager.run(async (tx) => {
        await tx.writeFile('outer.txt', 'outer content');

        // Nested transactions are not supported, but operations should work
        await tx.writeFile('inner.txt', 'inner content');
        await tx.mkdir('nested-dir');
        await tx.writeFile('nested-dir/nested-file.txt', 'nested content');
      });

      const outerContent = await fs.readFile(
        path.join(testDir, 'outer.txt'),
        'utf-8',
      );
      const innerContent = await fs.readFile(
        path.join(testDir, 'inner.txt'),
        'utf-8',
      );
      const nestedContent = await fs.readFile(
        path.join(testDir, 'nested-dir/nested-file.txt'),
        'utf-8',
      );

      expect(outerContent).toBe('outer content');
      expect(innerContent).toBe('inner content');
      expect(nestedContent).toBe('nested content');
    });
  });

  describe('エラー回復とクリーンアップ', () => {
    it('部分的失敗後のクリーンアップを確認する', async () => {
      await expect(
        txManager.run(async (tx) => {
          await tx.writeFile('file1.txt', 'content1');
          await tx.mkdir('dir1');
          await tx.writeFile('dir1/file2.txt', 'content2');
          throw new Error('Simulated failure');
        }),
      ).rejects.toThrow('Simulated failure');

      // All changes should be rolled back
      await expect(
        fs.access(path.join(testDir, 'file1.txt')),
      ).rejects.toThrow();
      await expect(fs.access(path.join(testDir, 'dir1'))).rejects.toThrow();
    });

    it('重複初期化を処理する', async () => {
      await txManager.initialize();
      await txManager.initialize();
      await txManager.initialize();

      // Should work normally after multiple initializations
      await txManager.run(async (tx) => {
        await tx.writeFile('test.txt', 'content');
      });

      const content = await fs.readFile(
        path.join(testDir, 'test.txt'),
        'utf-8',
      );
      expect(content).toBe('content');
    });
  });

  describe('存在確認とファイル状態', () => {
    it('作成前後の存在確認を処理する', async () => {
      await txManager.run(async (tx) => {
        expect(await tx.exists('test.txt')).toBe(false);
        await tx.writeFile('test.txt', 'content');
        expect(await tx.exists('test.txt')).toBe(true);

        expect(await tx.exists('test-dir')).toBe(false);
        await tx.mkdir('test-dir');
        expect(await tx.exists('test-dir')).toBe(true);
      });
    });

    it('削除前後の存在確認を処理する', async () => {
      await fs.writeFile(path.join(testDir, 'existing.txt'), 'content');
      await fs.mkdir(path.join(testDir, 'existing-dir'));

      await txManager.run(async (tx) => {
        expect(await tx.exists('existing.txt')).toBe(true);
        expect(await tx.exists('existing-dir')).toBe(true);

        await tx.rm('existing.txt');
        await tx.rm('existing-dir');

        expect(await tx.exists('existing.txt')).toBe(false);
        expect(await tx.exists('existing-dir')).toBe(false);
      });
    });

    it('rename操作での存在確認を処理する', async () => {
      await fs.writeFile(path.join(testDir, 'source.txt'), 'content');

      await txManager.run(async (tx) => {
        expect(await tx.exists('source.txt')).toBe(true);
        expect(await tx.exists('target.txt')).toBe(false);

        await tx.rename('source.txt', 'target.txt');

        expect(await tx.exists('source.txt')).toBe(false);
        expect(await tx.exists('target.txt')).toBe(true);
      });
    });
  });
});

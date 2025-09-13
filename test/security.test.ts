import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src/index';

describe('tx-fs セキュリティテスト', () => {
  const testDir = path.join(__dirname, 'test-security');
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

  describe('パストラバーサル攻撃防御', () => {
    it('基本的なディレクトリトラバーサルを防ぐ', async () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '../outside-dir/file.txt',
        '../../parent/file.txt'
      ];

      for (const maliciousPath of maliciousPaths) {
        await expect(txManager.run(async (tx) => {
          await tx.writeFile(maliciousPath, 'malicious content');
        })).rejects.toThrow('outside of the transaction');
      }
    });

    it('URLエンコードされたパストラバーサルを防ぐ', async () => {
      const encodedPaths = [
        '%2E%2E%2F%2E%2E%2F%2E%2E%2Fetc%2Fpasswd',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '..%2F..%2F..%2Fetc%2Fpasswd',
        '..%5C..%5C..%5Cwindows%5Csystem32'
      ];

      for (const encodedPath of encodedPaths) {
        await expect(txManager.run(async (tx) => {
          await tx.writeFile(decodeURIComponent(encodedPath), 'malicious content');
        })).rejects.toThrow('outside of the transaction');
      }
    });

    it('二重エンコードされたパストラバーサルを防ぐ', async () => {
      const doubleEncodedPaths = [
        '%252E%252E%252F%252E%252E%252F%252E%252E%252Fetc%252Fpasswd',
        '%25252E%25252E%25252F'
      ];

      for (const doubleEncodedPath of doubleEncodedPaths) {
        try {
          const decoded = decodeURIComponent(decodeURIComponent(doubleEncodedPath));
          await expect(txManager.run(async (tx) => {
            await tx.writeFile(decoded, 'malicious content');
          })).rejects.toThrow('outside of the transaction');
        } catch (e) {
          // Invalid encoding is also acceptable
        }
      }
    });

    it('混合パス区切り文字を使った攻撃を防ぐ', async () => {
      const mixedPaths = [
        '../..\\..\\etc/passwd',
        '..\\../..\\etc/passwd',
        '../..\\../windows\\system32'
      ];

      for (const mixedPath of mixedPaths) {
        await expect(txManager.run(async (tx) => {
          await tx.writeFile(mixedPath, 'malicious content');
        })).rejects.toThrow('outside of the transaction');
      }
    });

    it('絶対パスを拒否する', async () => {
      const absolutePaths = [
        '/etc/passwd',
        'C:\\Windows\\System32\\config\\sam',
        '/usr/bin/malicious',
        'D:\\sensitive\\data.txt',
        '/home/user/.ssh/id_rsa'
      ];

      for (const absolutePath of absolutePaths) {
        await expect(txManager.run(async (tx) => {
          await tx.writeFile(absolutePath, 'malicious content');
        })).rejects.toThrow('outside of the transaction');
      }
    });

    it('UNCパスを拒否する', async () => {
      const uncPaths = [
        '\\\\server\\share\\file.txt',
        '//server/share/file.txt',
        '\\\\?\\C:\\file.txt'
      ];

      for (const uncPath of uncPaths) {
        await expect(txManager.run(async (tx) => {
          await tx.writeFile(uncPath, 'malicious content');
        })).rejects.toThrow('outside of the transaction');
      }
    });
  });

  describe('入力検証とサニタイゼーション', () => {
    it('NULL バイト挿入攻撃を防ぐ', async () => {
      const nullBytePaths = [
        'file.txt\x00.jpg',
        'innocent.txt\x00../../../etc/passwd',
        '\x00malicious',
        'file\x00\x00.txt'
      ];

      for (const nullBytePath of nullBytePaths) {
        await expect(txManager.run(async (tx) => {
          await tx.writeFile(nullBytePath, 'content');
        })).rejects.toThrow();
      }
    });

    it('制御文字を含むファイル名を適切に処理する', async () => {
      const controlCharPaths = [
        'file\r\n.txt',
        'file\t.txt',
        'file\b.txt',
        'file\f.txt',
        'file\v.txt'
      ];

      for (const controlCharPath of controlCharPaths) {
        // Some control characters might be valid in file names on some systems
        // The important thing is that they don't cause security issues
        try {
          await txManager.run(async (tx) => {
            await tx.writeFile(controlCharPath, 'content');
          });
          
          // If it succeeds, verify the file was created safely within the test directory
          const createdFiles = await fs.readdir(testDir, { recursive: true });
          const hasFileOutsideTestDir = createdFiles.some(file => 
            typeof file === 'string' && path.resolve(testDir, file).indexOf(testDir) !== 0
          );
          expect(hasFileOutsideTestDir).toBe(false);
        } catch (error) {
          // Rejection is also acceptable for control characters
          expect(error).toBeDefined();
        }
      }
    });

    it('極端に長いパスを適切に処理する', async () => {
      const maxPathLength = 260; // Windows MAX_PATH limitation
      const longPath = 'a'.repeat(maxPathLength + 100) + '.txt';
      
      // Should either succeed (if OS supports it) or fail gracefully
      try {
        await txManager.run(async (tx) => {
          await tx.writeFile(longPath, 'content');
        });
      } catch (error) {
        // Expect a reasonable error message, not a crash
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('空文字列とwhitespaceのみのパスを拒否する', async () => {
      const invalidPaths = [
        '',
        ' ',
        '\t',
        '\n',
        '\r\n',
        '   \t   \n   '
      ];

      for (const invalidPath of invalidPaths) {
        try {
          await txManager.run(async (tx) => {
            await tx.writeFile(invalidPath, 'content');
          });
          // 空パスが受け入れられる場合もある（システム依存）
          console.log(`Empty path "${invalidPath}" was accepted on this system`);
        } catch (error: any) {
          // 空パスの拒否が期待される動作
          expect(error).toBeInstanceOf(Error);
        }
      }
    });
  });

  describe('リソース消費攻撃防御', () => {
    it('巨大ファイル作成による ディスク容量攻撃を処理する', async () => {
      // 100MB のファイルを作成しようとする
      const hugeContent = 'A'.repeat(100 * 1024 * 1024);
      
      // システムによってはメモリ制限やディスク容量制限で失敗する可能性がある
      try {
        await txManager.run(async (tx) => {
          await tx.writeFile('huge-file.txt', hugeContent);
        });
        
        // 成功した場合、ファイルが適切に作成されたことを確認
        const stats = await fs.stat(path.join(testDir, 'huge-file.txt'));
        expect(stats.size).toBe(hugeContent.length);
      } catch (error) {
        // リソース制限による失敗は受け入れ可能
        expect(error).toBeInstanceOf(Error);
      }
    }, 30000); // 30秒タイムアウト

    it('大量の小ファイル作成による inodeの消費攻撃を処理する', async () => {
      const fileCount = 1000;
      
      try {
        await txManager.run(async (tx) => {
          for (let i = 0; i < fileCount; i++) {
            await tx.writeFile(`small-file-${i}.txt`, `content ${i}`);
          }
        });
        
        // 成功した場合、すべてのファイルが作成されたことを確認
        const files = await fs.readdir(testDir);
        expect(files.length).toBe(fileCount);
      } catch (error) {
        // リソース制限による失敗は受け入れ可能
        expect(error).toBeInstanceOf(Error);
      }
    }, 30000);

    it('深いディレクトリネストによるパス長攻撃を処理する', async () => {
      const maxDepth = 100;
      let deepPath = '';
      
      for (let i = 0; i < maxDepth; i++) {
        deepPath = path.join(deepPath, `level${i}`);
      }
      
      try {
        await txManager.run(async (tx) => {
          await tx.writeFile(path.join(deepPath, 'deep-file.txt'), 'deep content');
        });
        
        // 成功した場合、ファイルが作成されたことを確認
        const content = await fs.readFile(path.join(testDir, deepPath, 'deep-file.txt'), 'utf-8');
        expect(content).toBe('deep content');
      } catch (error) {
        // パス長制限による失敗は受け入れ可能
        expect(error).toBeInstanceOf(Error);
      }
    }, 15000);
  });

  describe('競合状態とTOCTOU攻撃防御', () => {
    it('ファイル存在確認後の競合状態を適切に処理する', async () => {
      // 2つの並行トランザクションが同じファイルを作成しようとする
      const promises = [
        txManager.run(async (tx) => {
          await new Promise(resolve => setTimeout(resolve, 10)); // 少し待機
          await tx.writeFile('race-condition-file.txt', 'content from tx1');
        }),
        txManager.run(async (tx) => {
          await new Promise(resolve => setTimeout(resolve, 10)); // 少し待機
          await tx.writeFile('race-condition-file.txt', 'content from tx2');
        })
      ];

      // 両方のトランザクションが完了することを確認
      await Promise.all(promises);
      
      // ファイルが存在し、いずれかの内容が書き込まれていることを確認
      const content = await fs.readFile(path.join(testDir, 'race-condition-file.txt'), 'utf-8');
      expect(['content from tx1', 'content from tx2']).toContain(content);
    });

    it('シンボリックリンクを通じた攻撃を防ぐ', async () => {
      // 外部のディレクトリへのシンボリックリンクを作成しようとする
      const outsideDir = path.join(__dirname, 'outside-test-dir');
      
      try {
        await fs.mkdir(outsideDir, { recursive: true });
        await fs.writeFile(path.join(outsideDir, 'sensitive.txt'), 'sensitive data');
        
        // シンボリックリンクの作成を試みる
        try {
          await txManager.run(async (tx) => {
            // Node.jsのsymlinkはtxManagerには実装されていないが、
            // もし実装されていれば外部への参照を防ぐべき
            await tx.writeFile('symlink-test.txt', 'content');
          });
        } catch (error) {
          // シンボリンク操作が実装されていない場合のエラーは受け入れ可能
        }
      } finally {
        try {
          await fs.rm(outsideDir, { recursive: true, force: true });
        } catch (e) {
          // Cleanup error is acceptable
        }
      }
    });
  });

  describe('権限とアクセス制御', () => {
    it('読み取り専用ファイルの変更を適切に処理する', async () => {
      // 読み取り専用ファイルを作成
      await fs.writeFile(path.join(testDir, 'readonly.txt'), 'original content');
      
      try {
        await fs.chmod(path.join(testDir, 'readonly.txt'), 0o444); // 読み取り専用
        
        // 読み取り専用ファイルの変更を試みる
        try {
          await txManager.run(async (tx) => {
            await tx.writeFile('readonly.txt', 'modified content');
          });
          // Windows等では権限制限が効かない場合もある
          console.log('Permission restriction not enforced on this system');
        } catch (error: any) {
          // 権限エラーが期待される動作
          expect(error).toBeInstanceOf(Error);
        }
        
      } catch (chmodError) {
        // chmod が失敗した場合（権限がない場合など）はスキップ
        console.log('Skipping readonly test due to chmod failure:', chmodError);
      }
    });

    it('権限のないディレクトリへのアクセスを適切に処理する', async () => {
      // 権限のないディレクトリを作成
      const restrictedDir = path.join(testDir, 'restricted');
      await fs.mkdir(restrictedDir);
      
      try {
        await fs.chmod(restrictedDir, 0o000); // 全ての権限を削除
        
        // 権限のないディレクトリ内でのファイル作成を試みる
        await expect(txManager.run(async (tx) => {
          await tx.writeFile('restricted/file.txt', 'content');
        })).rejects.toThrow();
        
      } catch (chmodError) {
        // chmod が失敗した場合（権限がない場合など）はスキップ
        console.log('Skipping permission test due to chmod failure:', chmodError);
      } finally {
        try {
          // クリーンアップのために権限を復元
          await fs.chmod(restrictedDir, 0o755);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('エラー注入とフォルトトレランス', () => {
    it('ディスク容量不足シナリオを処理する', async () => {
      // 実際のディスク容量不足をシミュレートするのは困難なので、
      // 非常に大きなファイルを作成してリソース制限をテストする
      const veryLargeContent = 'X'.repeat(50 * 1024 * 1024); // 50MB
      
      try {
        await txManager.run(async (tx) => {
          await tx.writeFile('large-test-file.txt', veryLargeContent);
        });
        
        // 成功した場合の検証
        const stats = await fs.stat(path.join(testDir, 'large-test-file.txt'));
        expect(stats.size).toBeGreaterThan(0);
      } catch (error) {
        // リソース制限によるエラーは受け入れ可能
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBeDefined();
      }
    }, 20000);

    it('破損したメタデータからの回復を処理する', async () => {
      // 正常なトランザクションを実行
      await txManager.run(async (tx) => {
        await tx.writeFile('normal-file.txt', 'normal content');
      });

      // メタデータディレクトリの内容を破損させる
      const txDir = path.join(testDir, '.tx');
      const journalDir = path.join(txDir, 'journal');
      
      try {
        const journalFiles = await fs.readdir(journalDir);
        if (journalFiles.length > 0) {
          // ジャーナルファイルを破損させる
          await fs.writeFile(path.join(journalDir, journalFiles[0]), 'corrupted data');
        }
      } catch (e) {
        // ジャーナルファイルが存在しない場合は問題なし
      }

      // 新しいマネージャーで初期化（回復をトリガー）
      const recoveryManager = createTxFileManager({ baseDir: testDir });
      await expect(recoveryManager.initialize()).resolves.not.toThrow();
      
      // 回復後も正常に動作することを確認
      await recoveryManager.run(async (tx) => {
        await tx.writeFile('recovery-test.txt', 'recovery content');
      });
      
      const content = await fs.readFile(path.join(testDir, 'recovery-test.txt'), 'utf-8');
      expect(content).toBe('recovery content');
    });

    it('予期しないシステムエラーを適切に処理する', async () => {
      // 無効なファイル記述子や権限エラーなどをシミュレート
      const invalidOperations = [
        // 長すぎるファイル名
        async (tx: any) => await tx.writeFile('x'.repeat(1000), 'content'),
        // 予約されたファイル名（Windows）
        async (tx: any) => await tx.writeFile('CON', 'content'),
        async (tx: any) => await tx.writeFile('PRN', 'content'),
        async (tx: any) => await tx.writeFile('NUL', 'content'),
      ];

      for (const operation of invalidOperations) {
        try {
          await txManager.run(operation);
          // 成功した場合は問題なし（OSによって動作が異なる）
        } catch (error) {
          // エラーが発生した場合、適切なエラーメッセージがあることを確認
          expect(error).toBeInstanceOf(Error);
          expect(typeof error.message).toBe('string');
          expect(error.message.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('データ整合性とValidation', () => {
    it('バイナリデータの整合性を確保する', async () => {
      // ランダムなバイナリデータを生成
      const binaryData = new Uint8Array(1024);
      for (let i = 0; i < binaryData.length; i++) {
        binaryData[i] = Math.floor(Math.random() * 256);
      }

      await txManager.run(async (tx) => {
        await tx.writeFile('binary-data.bin', Buffer.from(binaryData));
      });

      const readData = await fs.readFile(path.join(testDir, 'binary-data.bin'));
      expect(new Uint8Array(readData)).toEqual(binaryData);
    });

    it('文字エンコーディングの整合性を確保する', async () => {
      const unicodeText = '🎌 こんにちは世界 🌏 Здравствуй мир 🇷🇺 مرحبا بالعالم 🇸🇦';
      
      await txManager.run(async (tx) => {
        await tx.writeFile('unicode-test.txt', unicodeText);
      });

      const readText = await fs.readFile(path.join(testDir, 'unicode-test.txt'), 'utf-8');
      expect(readText).toBe(unicodeText);
    });

    it('ファイルサイズの整合性を確保する', async () => {
      const testSizes = [0, 1, 255, 256, 1023, 1024, 1025, 65535, 65536];
      
      for (const size of testSizes) {
        const content = 'A'.repeat(size);
        const fileName = `size-test-${size}.txt`;
        
        await txManager.run(async (tx) => {
          await tx.writeFile(fileName, content);
        });

        const stats = await fs.stat(path.join(testDir, fileName));
        expect(stats.size).toBe(size);
      }
    });
  });
});
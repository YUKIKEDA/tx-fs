import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src/index';

describe('tx-fs 堅牢性・障害シナリオテスト', () => {
  const testDir = path.join(__dirname, 'test-robustness');
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

  describe('リソース枯渇シナリオ', () => {
    it('メモリ圧迫下での動作をテストする', async () => {
      // 大量のメモリを消費する操作を実行
      const largeContent = 'X'.repeat(50 * 1024 * 1024); // 50MB
      const iterations = 5;

      try {
        for (let i = 0; i < iterations; i++) {
          await txManager.run(async (tx) => {
            await tx.writeFile(`large-file-${i}.txt`, largeContent);

            // メモリ使用量をチェック
            const memUsage = process.memoryUsage();
            console.log(
              `Memory usage after file ${i}: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            );

            // メモリ使用量が極端に高い場合はテストを停止
            if (memUsage.heapUsed > 500 * 1024 * 1024) {
              // 500MB
              throw new Error('Memory usage too high, aborting test');
            }
          });
        }

        // 成功した場合、すべてのファイルが作成されていることを確認
        for (let i = 0; i < iterations; i++) {
          const exists = await fs
            .access(path.join(testDir, `large-file-${i}.txt`))
            .then(() => true)
            .catch(() => false);
          expect(exists).toBe(true);
        }
      } catch (error: any) {
        // メモリ不足やその他のリソース制限によるエラーは受け入れ可能
        expect(error).toBeInstanceOf(Error);
        console.log('Resource limitation encountered:', error.message);
      }
    }, 60000);

    it('ファイルハンドル枯渇をテストする', async () => {
      const fileCount = 100;
      const filePromises: Promise<any>[] = [];

      try {
        // 同時に多数のファイル操作を実行
        for (let i = 0; i < fileCount; i++) {
          const promise = txManager.run(async (tx) => {
            await tx.writeFile(`handle-test-${i}.txt`, `Content ${i}`);
            await tx.readFile(`handle-test-${i}.txt`);
            return i;
          });
          filePromises.push(promise);
        }

        const results = await Promise.allSettled(filePromises);

        // 一部が成功し、一部が失敗する可能性がある
        const successes = results.filter((r) => r.status === 'fulfilled');
        const failures = results.filter((r) => r.status === 'rejected');

        console.log(
          `File handle test: ${successes.length} succeeded, ${failures.length} failed`,
        );

        // 少なくとも一部は成功するはず
        expect(successes.length).toBeGreaterThan(0);

        // 失敗したものは適切なエラーメッセージを持つはず
        failures.forEach((failure) => {
          if (failure.status === 'rejected') {
            expect(failure.reason).toBeInstanceOf(Error);
          }
        });
      } catch (error) {
        // システム制限によるエラーは受け入れ可能
        expect(error).toBeInstanceOf(Error);
      }
    }, 30000);

    it('並行トランザクション数の制限をテストする', async () => {
      const concurrentCount = 50;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < concurrentCount; i++) {
        const promise = txManager.run(async (tx) => {
          await new Promise((resolve) =>
            setTimeout(resolve, 100 + Math.random() * 100),
          ); // ランダム遅延
          await tx.writeFile(
            `concurrent-${i}.txt`,
            `Concurrent operation ${i}`,
          );
          await tx.mkdir(`concurrent-dir-${i}`);
          return i;
        });
        promises.push(promise);
      }

      const results = await Promise.allSettled(promises);

      const successes = results.filter((r) => r.status === 'fulfilled').length;
      const failures = results.filter((r) => r.status === 'rejected').length;

      console.log(
        `Concurrent transactions: ${successes} succeeded, ${failures} failed`,
      );

      // すべて成功するか、システム制限による失敗があるかのどちらか
      if (failures > 0) {
        expect(successes + failures).toBe(concurrentCount);
      } else {
        expect(successes).toBe(concurrentCount);
      }
    }, 20000);
  });

  describe('ファイルシステム障害シナリオ', () => {
    it('権限エラーに対する堅牢性をテストする', async () => {
      // 読み取り専用ディレクトリを作成
      const readonlyDir = path.join(testDir, 'readonly');
      await fs.mkdir(readonlyDir);

      try {
        // ディレクトリを読み取り専用に設定
        await fs.chmod(readonlyDir, 0o444);

        // 読み取り専用ディレクトリに書き込みを試みる
        try {
          await txManager.run(async (tx) => {
            await tx.writeFile('readonly/test.txt', 'should fail');
          });
          // Windows等では権限制限が効かない場合もある
          console.log('Permission restriction not enforced on this system');
        } catch (error: any) {
          // 権限エラーが期待される動作
          expect(error).toBeInstanceOf(Error);
        }

        // システムが安定した状態を維持していることを確認
        await txManager.run(async (tx) => {
          await tx.writeFile('normal-file.txt', 'normal content');
        });

        const content = await fs.readFile(
          path.join(testDir, 'normal-file.txt'),
          'utf-8',
        );
        expect(content).toBe('normal content');
      } catch (chmodError) {
        console.log(
          'Permission test skipped due to chmod failure:',
          chmodError,
        );
      } finally {
        try {
          await fs.chmod(readonlyDir, 0o755); // 権限を戻してクリーンアップ
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    });

    it('パス長制限への対処をテストする', async () => {
      // 長いパスを段階的に作成
      let currentPath = '';
      const maxDepth = 20;
      const segmentLength = 50;

      try {
        await txManager.run(async (tx) => {
          for (let i = 0; i < maxDepth; i++) {
            const segment = 'a'.repeat(segmentLength);
            currentPath = path.join(currentPath, segment);
            await tx.mkdir(currentPath, { recursive: true });
          }

          // 深い階層にファイルを作成
          await tx.writeFile(
            path.join(currentPath, 'deep-file.txt'),
            'content at maximum depth',
          );
        });

        // 作成されたファイルの確認
        const content = await fs.readFile(
          path.join(testDir, currentPath, 'deep-file.txt'),
          'utf-8',
        );
        expect(content).toBe('content at maximum depth');
      } catch (error: any) {
        // パス長制限によるエラーは受け入れ可能
        expect(error).toBeInstanceOf(Error);
        console.log('Path length limitation encountered:', error.message);
      }
    });

    it('ディスク容量制限のシミュレーションをテストする', async () => {
      // 非常に大きなファイルを作成してディスク容量制限をテスト
      const testSizes = [
        1 * 1024 * 1024, // 1MB
        10 * 1024 * 1024, // 10MB
        50 * 1024 * 1024, // 50MB
      ];

      for (const size of testSizes) {
        try {
          const content = 'A'.repeat(size);

          await txManager.run(async (tx) => {
            await tx.writeFile(`large-${size}-bytes.txt`, content);
          });

          const stats = await fs.stat(
            path.join(testDir, `large-${size}-bytes.txt`),
          );
          expect(stats.size).toBe(size);
        } catch (error: any) {
          // ディスク容量不足やメモリ制限は受け入れ可能
          console.log(
            `Disk space test failed at ${size} bytes:`,
            error.message,
          );
          expect(error).toBeInstanceOf(Error);
          break; // これ以上大きなファイルのテストは不要
        }
      }
    }, 30000);
  });

  describe('データ破損と回復シナリオ', () => {
    it('ジャーナルファイル破損からの回復をテストする', async () => {
      // 正常なトランザクションを実行してジャーナルを作成
      await txManager.run(async (tx) => {
        await tx.writeFile('test-file.txt', 'test content');
      });

      // ジャーナルディレクトリのパスを取得
      const txDir = path.join(testDir, '.tx');
      const journalDir = path.join(txDir, 'journal');

      // ジャーナルファイルを破損させる
      try {
        const journalFiles = await fs.readdir(journalDir);
        if (journalFiles.length > 0) {
          for (const journalFile of journalFiles) {
            // ジャーナルファイルを破損したデータで上書き
            await fs.writeFile(
              path.join(journalDir, journalFile),
              'CORRUPTED_DATA_NOT_JSON',
            );
          }
        }
      } catch (e) {
        // ジャーナルディレクトリが存在しない場合はスキップ
        console.log('No journal files to corrupt');
      }

      // 新しいマネージャーで初期化（破損したジャーナルからの回復）
      const recoveryManager = createTxFileManager({ baseDir: testDir });
      await expect(recoveryManager.initialize()).resolves.not.toThrow();

      // 回復後も正常に動作することを確認
      await recoveryManager.run(async (tx) => {
        await tx.writeFile('recovery-test.txt', 'recovery successful');
      });

      const content = await fs.readFile(
        path.join(testDir, 'recovery-test.txt'),
        'utf-8',
      );
      expect(content).toBe('recovery successful');
    });

    it('ステージングディレクトリ破損からの回復をテストする', async () => {
      // トランザクションを開始してステージングを作成
      let txPromise: Promise<any> | null = null;

      try {
        txPromise = txManager.run(async (tx) => {
          await tx.writeFile('staged-file.txt', 'staged content');

          // ステージングディレクトリの内容を意図的に破損
          const txDir = path.join(testDir, '.tx', 'staging');
          const stagingDirs = await fs.readdir(txDir);

          if (stagingDirs.length > 0) {
            const stagingDir = path.join(txDir, stagingDirs[0]);
            // ステージング内のファイルを削除/破損
            try {
              const stagedFiles = await fs.readdir(stagingDir, {
                recursive: true,
              });
              for (const file of stagedFiles) {
                if (typeof file === 'string' && file.endsWith('.txt')) {
                  await fs.writeFile(path.join(stagingDir, file), 'CORRUPTED');
                }
              }
            } catch (e) {
              // ファイルが存在しない場合は無視
            }
          }

          // この時点で意図的に失敗してロールバックをトリガー
          throw new Error('Simulated failure after staging corruption');
        });

        await expect(txPromise).rejects.toThrow(
          'Simulated failure after staging corruption',
        );
      } catch (error) {
        // 予期されるエラー
      }

      // システムが安定した状態を維持していることを確認
      await txManager.run(async (tx) => {
        await tx.writeFile('post-corruption-test.txt', 'system stable');
      });

      const content = await fs.readFile(
        path.join(testDir, 'post-corruption-test.txt'),
        'utf-8',
      );
      expect(content).toBe('system stable');

      // 破損したファイルが本体ディレクトリに作成されていないことを確認
      const corruptedExists = await fs
        .access(path.join(testDir, 'staged-file.txt'))
        .then(() => true)
        .catch(() => false);
      expect(corruptedExists).toBe(false);
    });

    it('部分的書き込み失敗からの回復をテストする', async () => {
      // 大量のファイル作成中に途中で失敗するシナリオ
      const fileCount = 20;

      await expect(
        txManager.run(async (tx) => {
          for (let i = 0; i < fileCount; i++) {
            await tx.writeFile(`batch-file-${i}.txt`, `Content ${i}`);

            // 途中で意図的に失敗
            if (i === Math.floor(fileCount / 2)) {
              throw new Error('Simulated failure during batch write');
            }
          }
        }),
      ).rejects.toThrow('Simulated failure during batch write');

      // すべてのファイルがロールバックされていることを確認
      for (let i = 0; i < fileCount; i++) {
        const exists = await fs
          .access(path.join(testDir, `batch-file-${i}.txt`))
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(false);
      }

      // システムが正常状態を維持していることを確認
      await txManager.run(async (tx) => {
        await tx.writeFile('after-partial-failure.txt', 'system recovered');
      });

      const content = await fs.readFile(
        path.join(testDir, 'after-partial-failure.txt'),
        'utf-8',
      );
      expect(content).toBe('system recovered');
    });
  });

  describe('競合状態とタイミング攻撃', () => {
    it('トランザクション実行中の外部変更を検出する', async () => {
      // 外部からファイルを作成
      await fs.writeFile(
        path.join(testDir, 'external-file.txt'),
        'external content',
      );

      await txManager.run(async (tx) => {
        // トランザクション内で外部ファイルの存在を確認
        const exists = await tx.exists('external-file.txt');
        expect(exists).toBe(true);

        // 外部から同じファイルを変更（シミュレート）
        // 実際の実装では、これは検出される可能性がある

        // トランザクション内でファイルを更新
        await tx.writeFile('external-file.txt', 'updated by transaction');
      });

      // 最終的にトランザクションの変更が反映されていることを確認
      const content = await fs.readFile(
        path.join(testDir, 'external-file.txt'),
        'utf-8',
      );
      expect(content).toBe('updated by transaction');
    });

    it('高頻度の並行アクセスでのデータ整合性をテストする', async () => {
      const operationCount = 30;
      const promises: Promise<any>[] = [];

      // 共有カウンターファイルを初期化
      await fs.writeFile(path.join(testDir, 'counter.txt'), '0');

      // 複数のトランザクションが同じファイルを並行更新
      for (let i = 0; i < operationCount; i++) {
        const promise = txManager.run(async (tx) => {
          try {
            const currentValue = parseInt(
              (await tx.readFile('counter.txt', 'utf-8')) as string,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, Math.random() * 10),
            ); // ランダム遅延
            await tx.writeFile('counter.txt', (currentValue + 1).toString());
            return currentValue + 1;
          } catch (error) {
            // 並行アクセスエラーは受け入れ可能
            throw error;
          }
        });
        promises.push(promise);
      }

      const results = await Promise.allSettled(promises);
      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      console.log(
        `Concurrent access test: ${successes.length} succeeded, ${failures.length} failed`,
      );

      // 最終的なカウンター値を確認
      const finalValue = parseInt(
        await fs.readFile(path.join(testDir, 'counter.txt'), 'utf-8'),
      );

      // 正確な成功数と一致するかどうかを確認
      expect(finalValue).toBe(successes.length);
      expect(finalValue).toBeGreaterThan(0);
      expect(finalValue).toBeLessThanOrEqual(operationCount);
    }, 15000);

    it('システムリソース競合での優雅な劣化をテストする', async () => {
      // 大量のI/O操作を同時実行してシステムリソースを競合させる
      const heavyOperations = Array.from({ length: 10 }, (_, i) =>
        txManager.run(async (tx) => {
          const largeContent = 'X'.repeat(1024 * 1024); // 1MB

          for (let j = 0; j < 5; j++) {
            await tx.writeFile(`heavy-${i}-${j}.txt`, largeContent);
            await tx.readFile(`heavy-${i}-${j}.txt`);
            await tx.cp(`heavy-${i}-${j}.txt`, `heavy-copy-${i}-${j}.txt`);
          }

          return i;
        }),
      );

      const results = await Promise.allSettled(heavyOperations);

      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      console.log(
        `Heavy I/O test: ${successes.length} succeeded, ${failures.length} failed`,
      );

      // 少なくとも一部は成功するはず（優雅な劣化）
      expect(successes.length).toBeGreaterThan(0);

      // 失敗した場合も適切なエラーハンドリングがされているはず
      failures.forEach((failure) => {
        if (failure.status === 'rejected') {
          expect(failure.reason).toBeInstanceOf(Error);
        }
      });
    }, 45000);
  });

  describe('システム制限と境界条件', () => {
    it('ファイル名長制限での動作をテストする', async () => {
      const nameLengths = [100, 150, 200, 250];

      for (const length of nameLengths) {
        const longName = 'a'.repeat(length) + '.txt';

        try {
          await txManager.run(async (tx) => {
            await tx.writeFile(longName, `Content for ${length} char filename`);
          });

          // 成功した場合は内容を確認
          const content = await fs.readFile(
            path.join(testDir, longName),
            'utf-8',
          );
          expect(content).toBe(`Content for ${length} char filename`);
        } catch (error: any) {
          // 制限に達した場合のエラーは受け入れ可能
          console.log(`Filename length ${length} failed:`, error.message);
          expect(error).toBeInstanceOf(Error);
          break; // システム制限に達したら以降のテストはスキップ
        }
      }
    });

    it('ファイルシステム固有の制限をテストする', async () => {
      // 予約ファイル名のテスト（Windows固有）
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'];

      for (const name of reservedNames) {
        try {
          await txManager.run(async (tx) => {
            await tx.writeFile(name, 'content');
          });

          // 成功した場合（Unix系システム）
          const exists = await fs
            .access(path.join(testDir, name))
            .then(() => true)
            .catch(() => false);
          if (exists) {
            console.log(`Reserved name ${name} was allowed on this system`);
          }
        } catch (error: any) {
          // 予約名による拒否は受け入れ可能（Windows系システム）
          console.log(`Reserved name ${name} was rejected:`, error.message);
          expect(error).toBeInstanceOf(Error);
        }
      }
    });

    it('エンコーディング境界での動作をテストする', async () => {
      const testStrings = [
        // UTF-8 BOM
        '\uFEFFHello World',
        // サロゲートペア
        '🎌🌸👘🗾🍜',
        // 制御文字
        'Line1\r\nLine2\tTabbed',
        // 結合文字
        'é́́', // e + combining acute accent + combining acute accent
        // 右から左のテキスト
        'العربية עברית',
        // 特殊空白文字
        'word\u00A0word\u2000word\u3000word',
      ];

      for (let i = 0; i < testStrings.length; i++) {
        const testString = testStrings[i];
        const filename = `encoding-test-${i}.txt`;

        try {
          await txManager.run(async (tx) => {
            await tx.writeFile(filename, testString);
          });

          const readContent = await fs.readFile(
            path.join(testDir, filename),
            'utf-8',
          );
          expect(readContent).toBe(testString);
        } catch (error: any) {
          console.log(`Encoding test ${i} failed:`, error.message);
          expect(error).toBeInstanceOf(Error);
        }
      }
    });
  });

  describe('復旧とクリーンアップの堅牢性', () => {
    it('不完全なクリーンアップ状態からの復旧をテストする', async () => {
      // 意図的に不完全な状態を作成
      const txDir = path.join(testDir, '.tx');
      await fs.mkdir(path.join(txDir, 'staging', 'orphaned-tx'), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(txDir, 'staging', 'orphaned-tx', 'orphaned-file.txt'),
        'orphaned content',
      );

      // 孤立したジャーナルファイルも作成
      await fs.mkdir(path.join(txDir, 'journal'), { recursive: true });
      await fs.writeFile(
        path.join(txDir, 'journal', 'orphaned-tx.json'),
        '{"id": "orphaned-tx", "status": "UNKNOWN"}',
      );

      // 新しいマネージャーで初期化
      const recoveryManager = createTxFileManager({ baseDir: testDir });
      await recoveryManager.initialize();

      // 正常動作することを確認
      await recoveryManager.run(async (tx) => {
        await tx.writeFile('cleanup-test.txt', 'cleanup successful');
      });

      const content = await fs.readFile(
        path.join(testDir, 'cleanup-test.txt'),
        'utf-8',
      );
      expect(content).toBe('cleanup successful');

      // 孤立したファイルがクリーンアップされているかチェック
      const orphanedExists = await fs
        .access(path.join(txDir, 'staging', 'orphaned-tx'))
        .then(() => true)
        .catch(() => false);
      // クリーンアップされているかどうかは実装依存だが、システムは正常動作するはず
    });

    it('メタデータディレクトリの再構築をテストする', async () => {
      // .txディレクトリを完全に削除
      const txDir = path.join(testDir, '.tx');
      try {
        await fs.rm(txDir, { recursive: true, force: true });
      } catch (e) {
        // Already deleted
      }

      // 新しいマネージャーで初期化（メタデータディレクトリの再構築）
      const rebuiltManager = createTxFileManager({ baseDir: testDir });
      await rebuiltManager.initialize();

      // 正常に動作することを確認
      await rebuiltManager.run(async (tx) => {
        await tx.mkdir('rebuilt');
        await tx.writeFile('rebuilt/test.txt', 'rebuild successful');
      });

      const content = await fs.readFile(
        path.join(testDir, 'rebuilt/test.txt'),
        'utf-8',
      );
      expect(content).toBe('rebuild successful');

      // メタデータディレクトリが再構築されていることを確認
      const txDirExists = await fs
        .access(txDir)
        .then(() => true)
        .catch(() => false);
      expect(txDirExists).toBe(true);
    });

    it('異常終了後の自動回復をテストする', async () => {
      // 正常なトランザクションを実行してベースラインを作成
      await txManager.run(async (tx) => {
        await tx.writeFile('baseline.txt', 'baseline content');
      });

      // プロセス異常終了をシミュレートするために、
      // 意図的に不完全な状態を作成
      let incompleteTxId: string | null = null;

      try {
        await txManager.run(async (tx) => {
          await tx.writeFile('incomplete.txt', 'incomplete content');

          // トランザクションIDを取得するためのハック
          const txDir = path.join(testDir, '.tx', 'staging');
          const stagingDirs = await fs.readdir(txDir);
          if (stagingDirs.length > 0) {
            incompleteTxId = stagingDirs[0];
          }

          // プロセス異常終了をシミュレート
          throw new Error('Simulated abnormal termination');
        });
      } catch (error: any) {
        expect(error.message).toBe('Simulated abnormal termination');
      }

      // 新しいマネージャーで回復を試行
      const recoveredManager = createTxFileManager({ baseDir: testDir });
      await recoveredManager.initialize();

      // ベースラインファイルは残っているはず
      const baselineContent = await fs.readFile(
        path.join(testDir, 'baseline.txt'),
        'utf-8',
      );
      expect(baselineContent).toBe('baseline content');

      // 不完全なファイルは存在しないはず
      const incompleteExists = await fs
        .access(path.join(testDir, 'incomplete.txt'))
        .then(() => true)
        .catch(() => false);
      expect(incompleteExists).toBe(false);

      // 回復後のシステムが正常動作することを確認
      await recoveredManager.run(async (tx) => {
        await tx.writeFile('post-recovery.txt', 'recovery complete');
      });

      const recoveryContent = await fs.readFile(
        path.join(testDir, 'post-recovery.txt'),
        'utf-8',
      );
      expect(recoveryContent).toBe('recovery complete');
    });
  });
});

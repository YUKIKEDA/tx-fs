import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src/index';

describe('tx-fs 統合・ワークフローテスト', () => {
  const testDir = path.join(__dirname, 'test-integration');
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

  describe('複雑なワークフロー統合テスト', () => {
    it('プロジェクト構築ワークフロー（ビルドプロセス）をシミュレートする', async () => {
      // Step 1: プロジェクトの基本構造を作成
      await txManager.run(async (tx) => {
        // ソースディレクトリ構造を作成
        await tx.mkdir('src');
        await tx.mkdir('src/components');
        await tx.mkdir('src/utils');
        await tx.mkdir('tests');
        await tx.mkdir('build');
        
        // ソースファイルを作成
        await tx.writeFile('src/main.ts', 'export const main = () => console.log("Hello");');
        await tx.writeFile('src/components/Button.ts', 'export class Button {}');
        await tx.writeFile('src/utils/helpers.ts', 'export const helper = () => true;');
        await tx.writeFile('package.json', '{"name": "test-project", "version": "1.0.0"}');
        await tx.writeFile('README.md', '# Test Project');
      });

      // Step 2: ビルド前の準備（ファイルのコピーと変換）
      await txManager.run(async (tx) => {
        // 設定ファイルをビルドディレクトリにコピー
        await tx.cp('package.json', 'build/package.json');
        await tx.cp('README.md', 'build/README.md');
        
        // ソースファイルをビルドディレクトリにコピー
        await tx.cp('src', 'build/src', { recursive: true });
        
        // ビルド時にファイル名を変更（minify等をシミュレート）
        await tx.rename('build/src/main.ts', 'build/src/main.min.js');
        await tx.rename('build/src/components/Button.ts', 'build/src/components/Button.min.js');
      });

      // Step 3: 最適化とクリーンアップ
      await txManager.run(async (tx) => {
        // 不要な開発ファイルを削除
        await tx.rm('build/src/utils', { recursive: true });
        
        // バージョン情報を更新
        const packageJson = JSON.parse(await tx.readFile('build/package.json', 'utf-8') as string);
        packageJson.version = '1.0.1';
        await tx.writeFile('build/package.json', JSON.stringify(packageJson, null, 2));
        
        // ビルド完了マーカーを作成
        await tx.writeFile('build/.build-complete', new Date().toISOString());
      });

      // 結果検証
      const buildComplete = await fs.readFile(path.join(testDir, 'build/.build-complete'), 'utf-8');
      expect(buildComplete).toBeTruthy();

      const packageJson = JSON.parse(await fs.readFile(path.join(testDir, 'build/package.json'), 'utf-8'));
      expect(packageJson.version).toBe('1.0.1');

      const mainExists = await fs.access(path.join(testDir, 'build/src/main.min.js')).then(() => true).catch(() => false);
      expect(mainExists).toBe(true);

      const utilsExists = await fs.access(path.join(testDir, 'build/src/utils')).then(() => true).catch(() => false);
      expect(utilsExists).toBe(false);
    });

    it('バックアップ・復元ワークフローをシミュレートする', async () => {
      // Step 1: 元データを作成
      await txManager.run(async (tx) => {
        await tx.mkdir('data');
        await tx.mkdir('data/users');
        await tx.mkdir('data/logs');
        
        await tx.writeFile('data/users/user1.json', '{"id": 1, "name": "Alice"}');
        await tx.writeFile('data/users/user2.json', '{"id": 2, "name": "Bob"}');
        await tx.writeFile('data/logs/app.log', 'Log entry 1\nLog entry 2\n');
        await tx.writeFile('data/config.ini', '[database]\nhost=localhost\n');
      });

      // Step 2: バックアップ作成
      const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await txManager.run(async (tx) => {
        // スナップショットを作成
        await tx.snapshotDir('data');
        
        // バックアップディレクトリを作成
        await tx.mkdir('backups');
        await tx.mkdir(`backups/backup-${backupTimestamp}`);
        
        // データを全てバックアップディレクトリにコピー
        await tx.cp('data', `backups/backup-${backupTimestamp}/data`, { recursive: true });
        
        // バックアップメタデータを作成
        const backupInfo = {
          timestamp: backupTimestamp,
          source: 'data',
          fileCount: 4,
          status: 'completed'
        };
        await tx.writeFile(`backups/backup-${backupTimestamp}/backup-info.json`, JSON.stringify(backupInfo, null, 2));
      });

      // Step 3: データを変更（問題のあるアップデート）
      await txManager.run(async (tx) => {
        await tx.writeFile('data/users/user1.json', '{"id": 1, "name": "Alice Updated"}');
        await tx.writeFile('data/users/user3.json', '{"id": 3, "name": "Charlie"}');
        await tx.rm('data/logs/app.log');
        await tx.writeFile('data/logs/error.log', 'Error occurred!');
      });

      // Step 4: 問題を発見して復元を実行
      await txManager.run(async (tx) => {
        // 破損したデータディレクトリを削除
        await tx.rm('data', { recursive: true });
        
        // バックアップから復元
        await tx.cp(`backups/backup-${backupTimestamp}/data`, 'data', { recursive: true });
        
        // 復元ログを作成
        await tx.writeFile('restore.log', `Restored from backup-${backupTimestamp} at ${new Date().toISOString()}`);
      });

      // 結果検証
      const user1 = JSON.parse(await fs.readFile(path.join(testDir, 'data/users/user1.json'), 'utf-8'));
      expect(user1.name).toBe('Alice'); // 更新前の状態に戻っている

      const appLogExists = await fs.access(path.join(testDir, 'data/logs/app.log')).then(() => true).catch(() => false);
      expect(appLogExists).toBe(true); // 削除されたファイルが復元されている

      const user3Exists = await fs.access(path.join(testDir, 'data/users/user3.json')).then(() => true).catch(() => false);
      expect(user3Exists).toBe(false); // 新しく追加されたファイルは存在しない

      const restoreLog = await fs.readFile(path.join(testDir, 'restore.log'), 'utf-8');
      expect(restoreLog).toContain(backupTimestamp);
    });

    it('データベース移行ワークフローをシミュレートする', async () => {
      // Step 1: 古いスキーマのデータを作成
      await txManager.run(async (tx) => {
        await tx.mkdir('database');
        await tx.mkdir('database/v1');
        await tx.mkdir('database/v1/users');
        await tx.mkdir('database/v1/orders');
        
        // V1 スキーマのデータ
        await tx.writeFile('database/v1/users/1.json', '{"id": 1, "username": "alice", "email": "alice@example.com"}');
        await tx.writeFile('database/v1/users/2.json', '{"id": 2, "username": "bob", "email": "bob@example.com"}');
        await tx.writeFile('database/v1/orders/1.json', '{"id": 1, "user_id": 1, "amount": 100}');
        await tx.writeFile('database/v1/schema.json', '{"version": 1, "tables": ["users", "orders"]}');
      });

      // Step 2: 移行の準備とバックアップ
      await txManager.run(async (tx) => {
        // 移行前バックアップ
        await tx.cp('database/v1', 'database/backup-v1', { recursive: true });
        
        // V2 ディレクトリ構造を作成
        await tx.mkdir('database/v2');
        await tx.mkdir('database/v2/users');
        await tx.mkdir('database/v2/orders');
        await tx.mkdir('database/v2/audit');
      });

      // Step 3: データ移行を実行
      await txManager.run(async (tx) => {
        // ユーザーデータの移行（スキーマ変更）
        const user1 = JSON.parse(await tx.readFile('database/v1/users/1.json', 'utf-8') as string);
        const user2 = JSON.parse(await tx.readFile('database/v1/users/2.json', 'utf-8') as string);
        
        // V2 スキーマに変換（username → name, created_at追加）
        const user1V2 = {
          id: user1.id,
          name: user1.username,
          email: user1.email,
          created_at: '2024-01-01T00:00:00Z',
          status: 'active'
        };
        const user2V2 = {
          id: user2.id,
          name: user2.username,
          email: user2.email,
          created_at: '2024-01-01T00:00:00Z',
          status: 'active'
        };
        
        await tx.writeFile('database/v2/users/1.json', JSON.stringify(user1V2, null, 2));
        await tx.writeFile('database/v2/users/2.json', JSON.stringify(user2V2, null, 2));
        
        // 注文データの移行
        await tx.cp('database/v1/orders/1.json', 'database/v2/orders/1.json');
        
        // 新しいスキーマ情報
        const v2Schema = {
          version: 2,
          tables: ['users', 'orders', 'audit'],
          migration_from: 1,
          migration_date: new Date().toISOString()
        };
        await tx.writeFile('database/v2/schema.json', JSON.stringify(v2Schema, null, 2));
        
        // 移行監査ログ
        await tx.writeFile('database/v2/audit/migration.log', 'Migrated 2 users and 1 order from v1 to v2');
      });

      // Step 4: 古いバージョンをアーカイブ
      await txManager.run(async (tx) => {
        await tx.rename('database/v1', 'database/archived-v1');
        await tx.rename('database/v2', 'database/current');
        
        // カレントバージョンのシンボリックマーカー
        await tx.writeFile('database/VERSION', 'v2');
      });

      // 結果検証
      const currentSchema = JSON.parse(await fs.readFile(path.join(testDir, 'database/current/schema.json'), 'utf-8'));
      expect(currentSchema.version).toBe(2);

      const migratedUser = JSON.parse(await fs.readFile(path.join(testDir, 'database/current/users/1.json'), 'utf-8'));
      expect(migratedUser.name).toBe('alice');
      expect(migratedUser.status).toBe('active');
      expect(migratedUser.username).toBeUndefined(); // 古いフィールドは存在しない

      const version = await fs.readFile(path.join(testDir, 'database/VERSION'), 'utf-8');
      expect(version).toBe('v2');
    });
  });

  describe('並行ワークフロー統合テスト', () => {
    it('複数ユーザーの同時編集シナリオを処理する', async () => {
      // 初期プロジェクト状態を作成
      await txManager.run(async (tx) => {
        await tx.mkdir('project');
        await tx.writeFile('project/document.md', '# Document\n\nInitial content\n');
        await tx.writeFile('project/config.json', '{"version": "1.0.0", "authors": []}');
      });

      // 3人のユーザーが同時に異なる操作を実行
      const userOperations = [
        // User 1: ドキュメントを編集
        txManager.run(async (tx) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          const content = await tx.readFile('project/document.md');
          await tx.writeFile('project/document.md', content + '\n## Section by User 1\n\nContent added by user 1\n');
        }),
        
        // User 2: 設定を更新
        txManager.run(async (tx) => {
          await new Promise(resolve => setTimeout(resolve, 15));
          const config = JSON.parse(await tx.readFile('project/config.json', 'utf-8') as string);
          config.authors.push('user2');
          config.last_modified = new Date().toISOString();
          await tx.writeFile('project/config.json', JSON.stringify(config, null, 2));
        }),
        
        // User 3: 新しいファイルを追加
        txManager.run(async (tx) => {
          await new Promise(resolve => setTimeout(resolve, 5));
          await tx.writeFile('project/notes.txt', 'Notes added by user 3\n');
          await tx.mkdir('project/assets');
          await tx.writeFile('project/assets/style.css', 'body { margin: 0; }');
        })
      ];

      // 全ての操作が完了するまで待機
      await Promise.all(userOperations);

      // 結果検証
      const finalDocument = await fs.readFile(path.join(testDir, 'project/document.md'), 'utf-8');
      expect(finalDocument).toContain('Content added by user 1');

      const finalConfig = JSON.parse(await fs.readFile(path.join(testDir, 'project/config.json'), 'utf-8'));
      expect(finalConfig.authors).toContain('user2');

      const notesExists = await fs.access(path.join(testDir, 'project/notes.txt')).then(() => true).catch(() => false);
      expect(notesExists).toBe(true);

      const styleExists = await fs.access(path.join(testDir, 'project/assets/style.css')).then(() => true).catch(() => false);
      expect(styleExists).toBe(true);
    });

    it('継続的統合パイプラインをシミュレートする', async () => {
      // 複数のステップを並行実行するCI/CDパイプライン
      
      // Step 1: ソースコードを準備
      await txManager.run(async (tx) => {
        await tx.mkdir('repo');
        await tx.writeFile('repo/main.py', 'print("Hello World")');
        await tx.writeFile('repo/test_main.py', 'def test_main(): assert True');
        await tx.writeFile('repo/requirements.txt', 'pytest==7.0.0');
      });

      // Step 2: 並行パイプライン実行
      const pipelineSteps = [
        // Linting
        txManager.run(async (tx) => {
          await tx.mkdir('reports');
          await tx.writeFile('reports/lint.txt', 'Linting passed: No issues found');
        }),
        
        // Testing
        txManager.run(async (tx) => {
          if (!await tx.exists('reports')) {
            await tx.mkdir('reports');
          }
          await tx.writeFile('reports/test.xml', '<?xml version="1.0"?><testsuite tests="1" failures="0"></testsuite>');
        }),
        
        // Security scan
        txManager.run(async (tx) => {
          if (!await tx.exists('reports')) {
            await tx.mkdir('reports');
          }
          await tx.writeFile('reports/security.json', '{"vulnerabilities": [], "status": "passed"}');
        }),
        
        // Documentation generation
        txManager.run(async (tx) => {
          await tx.mkdir('docs');
          await tx.writeFile('docs/README.html', '<html><body><h1>Project Documentation</h1></body></html>');
        })
      ];

      await Promise.all(pipelineSteps);

      // Step 3: 結果集約とアーティファクト作成
      await txManager.run(async (tx) => {
        const pipelineReport = {
          timestamp: new Date().toISOString(),
          status: 'success',
          steps: {
            lint: 'passed',
            test: 'passed',
            security: 'passed',
            docs: 'generated'
          }
        };
        
        await tx.writeFile('reports/pipeline.json', JSON.stringify(pipelineReport, null, 2));
        
        // アーティファクトをパッケージ
        await tx.mkdir('artifacts');
        await tx.cp('repo', 'artifacts/source', { recursive: true });
        await tx.cp('reports', 'artifacts/reports', { recursive: true });
        await tx.cp('docs', 'artifacts/docs', { recursive: true });
      });

      // 結果検証
      const pipelineReport = JSON.parse(await fs.readFile(path.join(testDir, 'reports/pipeline.json'), 'utf-8'));
      expect(pipelineReport.status).toBe('success');

      const artifactsExist = await fs.access(path.join(testDir, 'artifacts')).then(() => true).catch(() => false);
      expect(artifactsExist).toBe(true);

      const docsExist = await fs.access(path.join(testDir, 'artifacts/docs/README.html')).then(() => true).catch(() => false);
      expect(docsExist).toBe(true);
    });
  });

  describe('エラー処理とリカバリー統合テスト', () => {
    it('複雑なワークフロー中の部分失敗からリカバリーする', async () => {
      // 初期状態を設定
      await txManager.run(async (tx) => {
        await tx.mkdir('workspace');
        await tx.writeFile('workspace/important.txt', 'Important data');
        await tx.writeFile('workspace/config.json', '{"backup": true}');
      });

      // 複雑な操作の途中で失敗するシナリオ
      await expect(txManager.run(async (tx) => {
        // Step 1: バックアップ作成（成功）
        await tx.cp('workspace', 'backup', { recursive: true });
        
        // Step 2: ワークスペースの変更（成功）
        await tx.writeFile('workspace/new-file.txt', 'New content');
        await tx.mkdir('workspace/temp');
        
        // Step 3: 設定更新（成功）
        const config = JSON.parse(await tx.readFile('workspace/config.json', 'utf-8') as string);
        config.last_backup = new Date().toISOString();
        await tx.writeFile('workspace/config.json', JSON.stringify(config, null, 2));
        
        // Step 4: 意図的な失敗
        throw new Error('Simulated failure during complex workflow');
      })).rejects.toThrow('Simulated failure during complex workflow');

      // リカバリー後の状態確認
      const importantExists = await fs.access(path.join(testDir, 'workspace/important.txt')).then(() => true).catch(() => false);
      expect(importantExists).toBe(true);

      const newFileExists = await fs.access(path.join(testDir, 'workspace/new-file.txt')).then(() => true).catch(() => false);
      expect(newFileExists).toBe(false); // ロールバックされている

      const backupExists = await fs.access(path.join(testDir, 'backup')).then(() => true).catch(() => false);
      expect(backupExists).toBe(false); // ロールバックされている

      const config = JSON.parse(await fs.readFile(path.join(testDir, 'workspace/config.json'), 'utf-8'));
      expect(config.last_backup).toBeUndefined(); // 変更がロールバックされている
    });

    it('マルチステップ移行の途中失敗をハンドルする', async () => {
      // 移行元データを準備
      await txManager.run(async (tx) => {
        await tx.mkdir('old-system');
        await tx.mkdir('old-system/data');
        await tx.writeFile('old-system/data/users.csv', 'id,name\n1,Alice\n2,Bob');
        await tx.writeFile('old-system/config.ini', '[database]\ntype=sqlite');
      });

      // 移行プロセスの途中で失敗
      await expect(txManager.run(async (tx) => {
        // Phase 1: 新システム準備（成功）
        await tx.mkdir('new-system');
        await tx.mkdir('new-system/data');
        
        // Phase 2: データ変換（成功）
        const csvData = await tx.readFile('old-system/data/users.csv', 'utf-8') as string;
        const lines = csvData.split('\n').slice(1); // ヘッダー除去
        
        for (const line of lines) {
          if (line.trim()) {
            const [id, name] = line.split(',');
            await tx.writeFile(`new-system/data/user-${id}.json`, JSON.stringify({ id: parseInt(id), name }));
          }
        }
        
        // Phase 3: 設定移行（成功）
        await tx.writeFile('new-system/config.json', '{"database": {"type": "postgresql"}}');
        
        // Phase 4: 検証とクリーンアップ（失敗）
        const userFiles = ['user-1.json', 'user-2.json'];
        for (const file of userFiles) {
          if (!await tx.exists(`new-system/data/${file}`)) {
            throw new Error(`Migration validation failed: ${file} not found`);
          }
        }
        
        // この時点で意図的な失敗をシミュレート
        throw new Error('Migration failed during cleanup phase');
      })).rejects.toThrow('Migration failed during cleanup phase');

      // 失敗後の状態確認
      const oldSystemExists = await fs.access(path.join(testDir, 'old-system')).then(() => true).catch(() => false);
      expect(oldSystemExists).toBe(true); // 元データは保護されている

      const newSystemExists = await fs.access(path.join(testDir, 'new-system')).then(() => true).catch(() => false);
      expect(newSystemExists).toBe(false); // 不完全な移行結果は削除されている

      // 元データの整合性確認
      const originalData = await fs.readFile(path.join(testDir, 'old-system/data/users.csv'), 'utf-8');
      expect(originalData).toContain('Alice');
      expect(originalData).toContain('Bob');
    });
  });

  describe('状態遷移とライフサイクル統合テスト', () => {
    it('アプリケーションライフサイクル全体をテストする', async () => {
      // Installation phase
      await txManager.run(async (tx) => {
        await tx.mkdir('app');
        await tx.mkdir('app/bin');
        await tx.mkdir('app/config');
        await tx.mkdir('app/data');
        await tx.mkdir('app/logs');
        
        await tx.writeFile('app/config/app.conf', 'debug=false\nport=8080');
        await tx.writeFile('app/data/schema.sql', 'CREATE TABLE users (id INT, name TEXT);');
        await tx.writeFile('app/VERSION', '1.0.0');
      });

      // First run (initialization)
      await txManager.run(async (tx) => {
        await tx.writeFile('app/data/users.db', 'SQLite database content');
        await tx.writeFile('app/logs/app.log', 'App started at ' + new Date().toISOString());
        await tx.writeFile('app/.initialized', 'true');
      });

      // Update phase
      await txManager.run(async (tx) => {
        // Backup before update
        await tx.cp('app/config', 'app/config.backup', { recursive: true });
        
        // Update configuration
        await tx.writeFile('app/config/app.conf', 'debug=false\nport=8080\nssl=true');
        await tx.writeFile('app/VERSION', '1.1.0');
        
        // Update log
        const existingLog = await tx.readFile('app/logs/app.log');
        await tx.writeFile('app/logs/app.log', existingLog + '\nUpdated to v1.1.0 at ' + new Date().toISOString());
      });

      // Maintenance phase
      await txManager.run(async (tx) => {
        // Log rotation
        await tx.rename('app/logs/app.log', 'app/logs/app.log.1');
        await tx.writeFile('app/logs/app.log', 'New log file started at ' + new Date().toISOString());
        
        // Data backup
        await tx.cp('app/data/users.db', 'app/data/users.db.backup');
        
        // Temporary maintenance flag
        await tx.writeFile('app/.maintenance', 'Maintenance started');
      });

      // Maintenance completion
      await txManager.run(async (tx) => {
        await tx.rm('app/.maintenance');
        
        const log = await tx.readFile('app/logs/app.log');
        await tx.writeFile('app/logs/app.log', log + '\nMaintenance completed at ' + new Date().toISOString());
      });

      // Verification
      const version = await fs.readFile(path.join(testDir, 'app/VERSION'), 'utf-8');
      expect(version).toBe('1.1.0');

      const maintenanceExists = await fs.access(path.join(testDir, 'app/.maintenance')).then(() => true).catch(() => false);
      expect(maintenanceExists).toBe(false);

      const backupExists = await fs.access(path.join(testDir, 'app/data/users.db.backup')).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);

      const configBackupExists = await fs.access(path.join(testDir, 'app/config.backup')).then(() => true).catch(() => false);
      expect(configBackupExists).toBe(true);
    });

    it('システム設定の段階的更新をテストする', async () => {
      // Initial system state
      await txManager.run(async (tx) => {
        await tx.mkdir('system');
        await tx.mkdir('system/config');
        await tx.mkdir('system/services');
        
        await tx.writeFile('system/config/network.conf', 'interface=eth0\ndhcp=true');
        await tx.writeFile('system/config/security.conf', 'firewall=enabled\nselinux=enforcing');
        await tx.writeFile('system/services/status.json', '{"web": "running", "db": "running"}');
      });

      // Phase 1: Network reconfiguration
      await txManager.run(async (tx) => {
        // Backup current config
        await tx.snapshotDir('system/config');
        
        // Update network settings
        await tx.writeFile('system/config/network.conf', 'interface=eth0\ndhcp=false\nip=192.168.1.100\ngateway=192.168.1.1');
        
        // Restart network service (simulated)
        const services = JSON.parse(await tx.readFile('system/services/status.json', 'utf-8') as string);
        services.network = 'restarted';
        services.timestamp = new Date().toISOString();
        await tx.writeFile('system/services/status.json', JSON.stringify(services, null, 2));
      });

      // Phase 2: Security updates
      await txManager.run(async (tx) => {
        // Update security settings
        const securityConf = await tx.readFile('system/config/security.conf');
        await tx.writeFile('system/config/security.conf', securityConf + '\nssl_protocols=TLSv1.2,TLSv1.3\npassword_policy=strong');
        
        // Create security audit log
        await tx.writeFile('system/security-audit.log', 'Security configuration updated at ' + new Date().toISOString());
      });

      // Phase 3: Service optimization
      await txManager.run(async (tx) => {
        const services = JSON.parse(await tx.readFile('system/services/status.json', 'utf-8') as string);
        services.web = 'optimized';
        services.db = 'optimized';
        services.cache = 'enabled';
        services.last_optimized = new Date().toISOString();
        await tx.writeFile('system/services/status.json', JSON.stringify(services, null, 2));
        
        // Create optimization report
        await tx.writeFile('system/optimization-report.txt', 'System optimization completed successfully');
      });

      // Final verification
      const networkConf = await fs.readFile(path.join(testDir, 'system/config/network.conf'), 'utf-8');
      expect(networkConf).toContain('ip=192.168.1.100');

      const securityConf = await fs.readFile(path.join(testDir, 'system/config/security.conf'), 'utf-8');
      expect(securityConf).toContain('ssl_protocols=TLSv1.2,TLSv1.3');

      const services = JSON.parse(await fs.readFile(path.join(testDir, 'system/services/status.json'), 'utf-8'));
      expect(services.cache).toBe('enabled');
      expect(services.last_optimized).toBeTruthy();

      const optimizationReport = await fs.readFile(path.join(testDir, 'system/optimization-report.txt'), 'utf-8');
      expect(optimizationReport).toContain('completed successfully');
    });
  });
});
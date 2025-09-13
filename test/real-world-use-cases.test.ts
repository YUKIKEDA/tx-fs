import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src/index';

describe('tx-fs 実用ユースケーステスト', () => {
  const testDir = path.join(__dirname, 'test-real-world');
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

  describe('開発ワークフロー用例', () => {
    it('Node.jsプロジェクトのビルドプロセスをシミュレートする', async () => {
      // プロジェクト初期化
      await txManager.run(async (tx) => {
        // プロジェクト構造の作成
        await tx.mkdir('src');
        await tx.mkdir('tests');
        await tx.mkdir('dist');
        
        // ソースファイル
        await tx.writeFile('src/index.ts', `
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
  
  multiply(a: number, b: number): number {
    return a * b;
  }
}
`);
        
        await tx.writeFile('src/utils.ts', `
export function formatNumber(num: number): string {
  return num.toLocaleString();
}
`);
        
        // テストファイル  
        await tx.writeFile('testfiles/calculator-unit-test.js', `
import { Calculator } from '../src/index';

describe('Calculator', () => {
  test('should add numbers', () => {
    const calc = new Calculator();
    expect(calc.add(2, 3)).toBe(5);
  });
});
`);
        
        // 設定ファイル
        await tx.writeFile('package.json', JSON.stringify({
          name: 'my-calculator',
          version: '1.0.0',
          main: 'dist/index.js',
          scripts: {
            build: 'tsc',
            test: 'jest'
          },
          devDependencies: {
            typescript: '^4.9.0',
            jest: '^29.0.0'
          }
        }, null, 2));
        
        await tx.writeFile('tsconfig.json', JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            outDir: './dist',
            strict: true
          },
          include: ['src/**/*'],
          exclude: ['tests/**/*']
        }, null, 2));
      });

      // ビルドプロセス（TypeScript → JavaScript）
      await txManager.run(async (tx) => {
        // TypeScriptコンパイル結果をシミュレート
        await tx.writeFile('dist/index.js', `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Calculator = void 0;

class Calculator {
    add(a, b) {
        return a + b;
    }
    multiply(a, b) {
        return a * b;
    }
}
exports.Calculator = Calculator;
`);
        
        await tx.writeFile('dist/utils.js', `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatNumber = void 0;

function formatNumber(num) {
    return num.toLocaleString();
}
exports.formatNumber = formatNumber;
`);
        
        // TypeScript宣言ファイル
        await tx.writeFile('dist/index.d.ts', `
export declare class Calculator {
    add(a: number, b: number): number;
    multiply(a: number, b: number): number;
}
`);
        
        // ビルド情報
        await tx.writeFile('dist/build-info.json', JSON.stringify({
          buildTime: new Date().toISOString(),
          version: '1.0.0',
          files: ['index.js', 'utils.js', 'index.d.ts']
        }, null, 2));
      });

      // パッケージング（本番用）
      await txManager.run(async (tx) => {
        // package.jsonを本番用に更新
        const packageJson = JSON.parse(await tx.readFile('package.json', 'utf-8') as string);
        delete packageJson.devDependencies;
        packageJson.files = ['dist/**/*'];
        await tx.writeFile('package.json', JSON.stringify(packageJson, null, 2));
        
        // README作成
        await tx.writeFile('README.md', `
# My Calculator

A simple calculator library.

## Installation

\`\`\`bash
npm install my-calculator
\`\`\`

## Usage

\`\`\`javascript
const { Calculator } = require('my-calculator');
const calc = new Calculator();
console.log(calc.add(2, 3)); // 5
\`\`\`
`);
        
        // ライセンス
        await tx.writeFile('LICENSE', `MIT License

Copyright (c) 2024 My Calculator

Permission is hereby granted, free of charge, to any person obtaining a copy...`);
      });

      // 検証
      const packageJson = JSON.parse(await fs.readFile(path.join(testDir, 'package.json'), 'utf-8'));
      expect(packageJson.devDependencies).toBeUndefined();
      expect(packageJson.files).toEqual(['dist/**/*']);

      const buildInfo = JSON.parse(await fs.readFile(path.join(testDir, 'dist/build-info.json'), 'utf-8'));
      expect(buildInfo.files).toHaveLength(3);

      const readmeExists = await fs.access(path.join(testDir, 'README.md')).then(() => true).catch(() => false);
      expect(readmeExists).toBe(true);
    });

    it('Gitリポジトリのブランチ切り替えをシミュレートする', async () => {
      // mainブランチの状態を作成
      await txManager.run(async (tx) => {
        await tx.writeFile('main.py', 'print("Hello from main branch")');
        await tx.writeFile('config.yaml', 'version: 1.0\nfeatures:\n  - basic\n  - stable');
        await tx.writeFile('README.md', '# Project Main\n\nThis is the main branch.');
      });

      // feature-branchに切り替え（新機能開発）
      await txManager.run(async (tx) => {
        // 既存ファイルを修正
        await tx.writeFile('main.py', `
import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', default='World')
    args = parser.parse_args()
    print(f"Hello {args.name} from feature branch!")

if __name__ == '__main__':
    main()
`);
        
        // 新機能の設定を追加
        await tx.writeFile('config.yaml', `
version: 1.1.0-dev
features:
  - basic
  - stable
  - experimental
  - cli_args
debug: true
`);
        
        // 新しいファイルを追加
        await tx.writeFile('feature.py', `
def new_feature():
    return "This is a new feature"
`);
        
        // READMEを更新
        await tx.writeFile('README.md', `
# Project Feature Branch

This is the feature development branch.

## New Features
- Command line arguments
- Enhanced configuration
- New experimental features
`);
      });

      // develop-branchに切り替え（統合テスト）
      await txManager.run(async (tx) => {
        // 複数の機能を統合
        await tx.writeFile('main.py', `
import argparse
import yaml
from feature import new_feature

def load_config():
    with open('config.yaml', 'r') as f:
        return yaml.safe_load(f)

def main():
    config = load_config()
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', default='World')
    parser.add_argument('--feature', action='store_true')
    args = parser.parse_args()
    
    print(f"Hello {args.name} from develop branch!")
    print(f"Version: {config['version']}")
    
    if args.feature:
        print(new_feature())

if __name__ == '__main__':
    main()
`);
        
        // 統合テスト用の設定
        await tx.writeFile('config.yaml', `
version: 1.1.0-rc1
features:
  - basic
  - stable
  - experimental
  - cli_args
  - integration
debug: false
testing: true
`);
        
        // テストファイルを追加
        await tx.writeFile('test_main.py', `
import unittest
from main import load_config
from feature import new_feature

class TestMain(unittest.TestCase):
    def test_config_loading(self):
        config = load_config()
        self.assertIn('version', config)
    
    def test_new_feature(self):
        result = new_feature()
        self.assertEqual(result, "This is a new feature")

if __name__ == '__main__':
    unittest.main()
`);
      });

      // リリース準備（release-branch）
      await txManager.run(async (tx) => {
        // 本番用設定
        await tx.writeFile('config.yaml', `
version: 1.1.0
features:
  - basic
  - stable
  - cli_args
debug: false
production: true
`);
        
        // 不要な開発ファイルを削除
        await tx.rm('test_main.py');
        
        // リリースノートを作成
        await tx.writeFile('CHANGELOG.md', `
# Changelog

## [1.1.0] - ${new Date().toISOString().split('T')[0]}

### Added
- Command line argument support
- Enhanced configuration system
- New feature module

### Changed
- Improved main application structure

### Removed
- Debug and testing configurations
`);
        
        // 最終的なREADME
        await tx.writeFile('README.md', `
# Project v1.1.0

A production-ready application with enhanced features.

## Installation

\`\`\`bash
python main.py --name "Your Name" --feature
\`\`\`

## Features
- Command line interface
- Configurable settings
- Extensible architecture
`);
      });

      // 検証
      const config = await fs.readFile(path.join(testDir, 'config.yaml'), 'utf-8');
      expect(config).toContain('version: 1.1.0');
      expect(config).toContain('production: true');

      const changelog = await fs.readFile(path.join(testDir, 'CHANGELOG.md'), 'utf-8');
      expect(changelog).toContain('## [1.1.0]');

      const testFileExists = await fs.access(path.join(testDir, 'test_main.py')).then(() => true).catch(() => false);
      expect(testFileExists).toBe(false);
    });
  });

  describe('データ処理ワークフロー用例', () => {
    it('ETL（Extract, Transform, Load）パイプラインをシミュレートする', async () => {
      // 初期データソースを作成
      await txManager.run(async (tx) => {
        await tx.mkdir('data');
        await tx.mkdir('data/raw');
        await tx.mkdir('data/processed');
        await tx.mkdir('data/output');
        
        // 生のCSVデータ
        await tx.writeFile('data/raw/users.csv', `
id,name,email,age,country
1,Alice,alice@example.com,25,USA
2,Bob,bob@example.com,30,Canada
3,Charlie,charlie@example.com,35,UK
4,Diana,diana@example.com,28,Australia
5,Eve,eve@example.com,32,France
`);
        
        await tx.writeFile('data/raw/orders.csv', `
order_id,user_id,product,amount,date
101,1,Laptop,999.99,2024-01-15
102,2,Mouse,29.99,2024-01-16
103,1,Keyboard,79.99,2024-01-17
104,3,Monitor,299.99,2024-01-18
105,4,Tablet,499.99,2024-01-19
`);
        
        // ログファイル
        await tx.writeFile('data/raw/app.log', `
2024-01-15 10:00:00 INFO User 1 logged in
2024-01-15 10:05:00 INFO Order 101 created
2024-01-15 10:10:00 WARN Payment delayed for order 101
2024-01-15 10:15:00 INFO Payment completed for order 101
2024-01-16 09:30:00 INFO User 2 logged in
2024-01-16 09:35:00 INFO Order 102 created
`);
      });

      // Extract & Transform フェーズ
      await txManager.run(async (tx) => {
        // CSVデータをJSONに変換
        const usersCSV = await tx.readFile('data/raw/users.csv', 'utf-8') as string;
        const usersLines = usersCSV.trim().split('\n').slice(1); // ヘッダー除去
        
        const users = usersLines.map(line => {
          const [id, name, email, age, country] = line.split(',');
          return {
            id: parseInt(id),
            name,
            email,
            age: parseInt(age),
            country,
            created_at: new Date().toISOString()
          };
        });
        
        await tx.writeFile('data/processed/users.json', JSON.stringify(users, null, 2));
        
        // 注文データの変換
        const ordersCSV = await tx.readFile('data/raw/orders.csv', 'utf-8') as string;
        const ordersLines = ordersCSV.trim().split('\n').slice(1);
        
        const orders = ordersLines.map(line => {
          const [order_id, user_id, product, amount, date] = line.split(',');
          return {
            order_id: parseInt(order_id),
            user_id: parseInt(user_id),
            product,
            amount: parseFloat(amount),
            date,
            status: 'completed'
          };
        });
        
        await tx.writeFile('data/processed/orders.json', JSON.stringify(orders, null, 2));
        
        // ログデータの解析
        const logs = await tx.readFile('data/raw/app.log', 'utf-8') as string;
        const logLines = logs.trim().split('\n');
        
        const parsedLogs = logLines.map(line => {
          const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (\w+) (.+)$/);
          if (match) {
            return {
              timestamp: match[1],
              level: match[2],
              message: match[3]
            };
          }
          return null;
        }).filter(Boolean);
        
        await tx.writeFile('data/processed/logs.json', JSON.stringify(parsedLogs, null, 2));
      });

      // Load & Aggregate フェーズ
      await txManager.run(async (tx) => {
        // ユーザーと注文データを結合
        const users = JSON.parse(await tx.readFile('data/processed/users.json', 'utf-8') as string);
        const orders = JSON.parse(await tx.readFile('data/processed/orders.json', 'utf-8') as string);
        
        const userOrderSummary = users.map(user => {
          const userOrders = orders.filter(order => order.user_id === user.id);
          const totalAmount = userOrders.reduce((sum, order) => sum + order.amount, 0);
          
          return {
            user_id: user.id,
            name: user.name,
            email: user.email,
            country: user.country,
            total_orders: userOrders.length,
            total_amount: totalAmount,
            avg_order_value: userOrders.length > 0 ? totalAmount / userOrders.length : 0
          };
        });
        
        await tx.writeFile('data/output/user_summary.json', JSON.stringify(userOrderSummary, null, 2));
        
        // 国別集計
        const countryStats = userOrderSummary.reduce((acc, user) => {
          if (!acc[user.country]) {
            acc[user.country] = {
              country: user.country,
              user_count: 0,
              total_revenue: 0,
              avg_revenue_per_user: 0
            };
          }
          
          acc[user.country].user_count++;
          acc[user.country].total_revenue += user.total_amount;
          
          return acc;
        }, {} as any);
        
        // 平均値を計算
        Object.values(countryStats).forEach((stat: any) => {
          stat.avg_revenue_per_user = stat.total_revenue / stat.user_count;
        });
        
        await tx.writeFile('data/output/country_stats.json', JSON.stringify(Object.values(countryStats), null, 2));
        
        // ETL実行レポート
        const report = {
          execution_time: new Date().toISOString(),
          processed_files: ['users.csv', 'orders.csv', 'app.log'],
          output_files: ['user_summary.json', 'country_stats.json'],
          total_users: users.length,
          total_orders: orders.length,
          status: 'completed'
        };
        
        await tx.writeFile('data/output/etl_report.json', JSON.stringify(report, null, 2));
      });

      // 検証
      const userSummary = JSON.parse(await fs.readFile(path.join(testDir, 'data/output/user_summary.json'), 'utf-8'));
      expect(userSummary).toHaveLength(5);
      expect(userSummary[0]).toHaveProperty('total_amount');

      const countryStats = JSON.parse(await fs.readFile(path.join(testDir, 'data/output/country_stats.json'), 'utf-8'));
      expect(countryStats.length).toBeGreaterThan(0);
      expect(countryStats[0]).toHaveProperty('avg_revenue_per_user');

      const report = JSON.parse(await fs.readFile(path.join(testDir, 'data/output/etl_report.json'), 'utf-8'));
      expect(report.status).toBe('completed');
      expect(report.total_users).toBe(5);
    });

    it('ログローテーションとアーカイブをシミュレートする', async () => {
      // 初期ログファイルを作成
      await txManager.run(async (tx) => {
        await tx.mkdir('logs');
        await tx.mkdir('logs/archive');
        
        // アクティブログファイル
        await tx.writeFile('logs/app.log', `
2024-01-20 09:00:00 INFO Application started
2024-01-20 09:01:00 INFO User authentication enabled
2024-01-20 09:02:00 DEBUG Loading configuration
2024-01-20 09:03:00 INFO Server listening on port 8080
`);
        
        await tx.writeFile('logs/error.log', `
2024-01-20 09:05:00 WARN Deprecated API used
2024-01-20 09:10:00 ERROR Database connection timeout
2024-01-20 09:15:00 ERROR Failed to process request
`);
        
        await tx.writeFile('logs/access.log', `
127.0.0.1 - - [20/Jan/2024:09:05:00 +0000] "GET / HTTP/1.1" 200 1234
127.0.0.1 - - [20/Jan/2024:09:06:00 +0000] "GET /api/users HTTP/1.1" 200 567
127.0.0.1 - - [20/Jan/2024:09:07:00 +0000] "POST /api/login HTTP/1.1" 201 89
`);
      });

      // ログローテーション実行
      await txManager.run(async (tx) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        
        // 現在のログファイルをアーカイブ
        await tx.cp('logs/app.log', `logs/archive/app-${timestamp}.log`);
        await tx.cp('logs/error.log', `logs/archive/error-${timestamp}.log`);
        await tx.cp('logs/access.log', `logs/archive/access-${timestamp}.log`);
        
        // 新しい空のログファイルを作成
        await tx.writeFile('logs/app.log', `${new Date().toISOString()} INFO Log rotation completed\n`);
        await tx.writeFile('logs/error.log', '');
        await tx.writeFile('logs/access.log', '');
        
        // ローテーション情報を記録
        const rotationInfo = {
          rotation_date: new Date().toISOString(),
          archived_files: [
            `app-${timestamp}.log`,
            `error-${timestamp}.log`,
            `access-${timestamp}.log`
          ],
          retention_days: 30
        };
        
        await tx.writeFile('logs/rotation.json', JSON.stringify(rotationInfo, null, 2));
      });

      // ログ圧縮とクリーンアップ
      await txManager.run(async (tx) => {
        // 7日以上古いアーカイブを圧縮済みとしてマーク
        const compressedLogs = [
          'app-2024-01-13.log.gz',
          'error-2024-01-13.log.gz',
          'access-2024-01-13.log.gz'
        ];
        
        for (const compressedLog of compressedLogs) {
          await tx.writeFile(`logs/archive/${compressedLog}`, `[COMPRESSED] Original log content for ${compressedLog}`);
        }
        
        // 30日以上古いログの削除リストを作成
        const cleanupList = [
          'app-2023-12-20.log.gz',
          'error-2023-12-20.log.gz',
          'access-2023-12-20.log.gz'
        ];
        
        // クリーンアップレポート
        const cleanupReport = {
          cleanup_date: new Date().toISOString(),
          compressed_files: compressedLogs,
          deleted_files: cleanupList,
          total_archived_files: compressedLogs.length
        };
        
        await tx.writeFile('logs/cleanup-report.json', JSON.stringify(cleanupReport, null, 2));
        
        // ログ統計を更新
        const stats = {
          active_logs: ['app.log', 'error.log', 'access.log'],
          archived_count: compressedLogs.length,
          last_rotation: new Date().toISOString(),
          disk_usage_mb: 125.7
        };
        
        await tx.writeFile('logs/stats.json', JSON.stringify(stats, null, 2));
      });

      // 検証
      const rotationInfo = JSON.parse(await fs.readFile(path.join(testDir, 'logs/rotation.json'), 'utf-8'));
      expect(rotationInfo.archived_files).toHaveLength(3);

      const cleanupReport = JSON.parse(await fs.readFile(path.join(testDir, 'logs/cleanup-report.json'), 'utf-8'));
      expect(cleanupReport.compressed_files).toHaveLength(3);

      const newAppLog = await fs.readFile(path.join(testDir, 'logs/app.log'), 'utf-8');
      expect(newAppLog).toContain('Log rotation completed');

      const archiveExists = await fs.access(path.join(testDir, 'logs/archive')).then(() => true).catch(() => false);
      expect(archiveExists).toBe(true);
    });
  });

  describe('Webアプリケーションデプロイメント用例', () => {
    it('Blue-Greenデプロイメントをシミュレートする', async () => {
      // 現在の本番環境（Green）をセットアップ
      await txManager.run(async (tx) => {
        await tx.mkdir('production');
        await tx.mkdir('production/green');
        await tx.mkdir('production/green/app');
        await tx.mkdir('production/green/config');
        
        // 現在の本番アプリケーション
        await tx.writeFile('production/green/app/index.html', `
<!DOCTYPE html>
<html>
<head><title>App v1.0</title></head>
<body>
  <h1>Welcome to App Version 1.0</h1>
  <p>Current production version</p>
</body>
</html>
`);
        
        await tx.writeFile('production/green/app/app.js', `
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ version: '1.0.0', status: 'production' });
});

app.listen(8080, () => {
  console.log('App v1.0 running on port 8080');
});
`);
        
        await tx.writeFile('production/green/config/app.json', JSON.stringify({
          version: '1.0.0',
          environment: 'production',
          database: {
            host: 'prod-db.example.com',
            port: 5432
          },
          redis: {
            host: 'prod-redis.example.com',
            port: 6379
          }
        }, null, 2));
        
        // アクティブシンボリックリンクをシミュレート
        await tx.writeFile('production/active', 'green');
      });

      // 新バージョンをBlue環境にデプロイ
      await txManager.run(async (tx) => {
        await tx.mkdir('production/blue');
        await tx.mkdir('production/blue/app');
        await tx.mkdir('production/blue/config');
        
        // 新バージョンのアプリケーション
        await tx.writeFile('production/blue/app/index.html', `
<!DOCTYPE html>
<html>
<head><title>App v2.0</title></head>
<body>
  <h1>Welcome to App Version 2.0</h1>
  <p>New features and improvements!</p>
  <div id="new-feature">
    <h2>New Feature</h2>
    <p>This is a brand new feature in v2.0</p>
  </div>
</body>
</html>
`);
        
        await tx.writeFile('production/blue/app/app.js', `
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ 
    version: '2.0.0', 
    status: 'production',
    features: ['new-dashboard', 'enhanced-api', 'improved-performance']
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', version: '2.0.0' });
});

app.listen(8080, () => {
  console.log('App v2.0 running on port 8080');
});
`);
        
        await tx.writeFile('production/blue/config/app.json', JSON.stringify({
          version: '2.0.0',
          environment: 'production',
          database: {
            host: 'prod-db.example.com',
            port: 5432,
            pool_size: 20
          },
          redis: {
            host: 'prod-redis.example.com',
            port: 6379,
            cluster: true
          },
          features: {
            new_dashboard: true,
            enhanced_api: true
          }
        }, null, 2));
        
        // デプロイメント情報
        await tx.writeFile('production/blue/deployment.json', JSON.stringify({
          deployed_at: new Date().toISOString(),
          version: '2.0.0',
          previous_version: '1.0.0',
          rollback_available: true
        }, null, 2));
      });

      // ヘルスチェックと切り替え
      await txManager.run(async (tx) => {
        // Blue環境のヘルスチェック（シミュレート）
        const blueConfig = JSON.parse(await tx.readFile('production/blue/config/app.json', 'utf-8') as string);
        
        if (blueConfig.version === '2.0.0') {
          // ヘルスチェック成功、トラフィックを切り替え
          await tx.writeFile('production/active', 'blue');
          
          // 切り替えログ
          await tx.writeFile('production/switch.log', `
${new Date().toISOString()} INFO Traffic switched from green to blue
${new Date().toISOString()} INFO Active version: ${blueConfig.version}
${new Date().toISOString()} INFO Monitoring new deployment...
`);
          
          // Green環境を待機状態に
          const greenConfig = JSON.parse(await tx.readFile('production/green/config/app.json', 'utf-8') as string);
          greenConfig.status = 'standby';
          await tx.writeFile('production/green/config/app.json', JSON.stringify(greenConfig, null, 2));
        }
      });

      // モニタリングと確認
      await txManager.run(async (tx) => {
        // デプロイメント成功の確認
        const active = await tx.readFile('production/active', 'utf-8') as string;
        
        if (active.trim() === 'blue') {
          // 成功レポート
          const report = {
            deployment_successful: true,
            active_environment: 'blue',
            active_version: '2.0.0',
            rollback_available: true,
            monitoring_status: 'active',
            health_check_passed: true,
            timestamp: new Date().toISOString()
          };
          
          await tx.writeFile('production/deployment-report.json', JSON.stringify(report, null, 2));
          
          // 古いGreen環境は保持（即座にロールバック可能）
          await tx.writeFile('production/rollback-ready.flag', 'green environment ready for rollback');
        }
      });

      // 検証
      const active = await fs.readFile(path.join(testDir, 'production/active'), 'utf-8');
      expect(active.trim()).toBe('blue');

      const blueConfig = JSON.parse(await fs.readFile(path.join(testDir, 'production/blue/config/app.json'), 'utf-8'));
      expect(blueConfig.version).toBe('2.0.0');

      const report = JSON.parse(await fs.readFile(path.join(testDir, 'production/deployment-report.json'), 'utf-8'));
      expect(report.deployment_successful).toBe(true);

      const rollbackReady = await fs.access(path.join(testDir, 'production/rollback-ready.flag')).then(() => true).catch(() => false);
      expect(rollbackReady).toBe(true);
    });

    it('設定ファイルの段階的アップデートをシミュレートする', async () => {
      // 初期システム設定
      await txManager.run(async (tx) => {
        await tx.mkdir('system');
        await tx.mkdir('system/config');
        await tx.mkdir('system/backup');
        
        // データベース設定
        await tx.writeFile('system/config/database.yaml', `
production:
  host: db.example.com
  port: 5432
  database: myapp_prod
  username: app_user
  pool_size: 10
  timeout: 30

staging:
  host: staging-db.example.com
  port: 5432
  database: myapp_staging
  username: staging_user
  pool_size: 5
  timeout: 10
`);
        
        // Redis設定
        await tx.writeFile('system/config/redis.yaml', `
production:
  host: redis.example.com
  port: 6379
  database: 0
  timeout: 5

staging:
  host: staging-redis.example.com
  port: 6379
  database: 1
  timeout: 2
`);
        
        // アプリケーション設定
        await tx.writeFile('system/config/app.yaml', `
app:
  name: MyApplication
  version: 1.0.0
  debug: false
  log_level: info

security:
  jwt_secret: prod_secret_key
  session_timeout: 3600
  max_login_attempts: 5

features:
  email_notifications: true
  file_upload: true
  analytics: true
`);
      });

      // 段階1: データベース設定の更新
      await txManager.run(async (tx) => {
        // 現在の設定をバックアップ
        await tx.cp('system/config/database.yaml', `system/backup/database-backup-${Date.now()}.yaml`);
        
        // データベース設定を更新（接続プール増加）
        await tx.writeFile('system/config/database.yaml', `
production:
  host: db.example.com
  port: 5432
  database: myapp_prod
  username: app_user
  pool_size: 20  # 増加
  timeout: 45    # 増加
  ssl: true      # 追加

staging:
  host: staging-db.example.com
  port: 5432
  database: myapp_staging
  username: staging_user
  pool_size: 10  # 増加
  timeout: 15    # 増加
  ssl: false
`);
        
        // 変更ログ
        await tx.writeFile('system/config/changes.log', `
${new Date().toISOString()} Database configuration updated
- Increased production pool_size from 10 to 20
- Increased production timeout from 30 to 45
- Added SSL configuration
- Updated staging settings
`);
      });

      // 段階2: Redis設定とクラスタリング
      await txManager.run(async (tx) => {
        await tx.cp('system/config/redis.yaml', `system/backup/redis-backup-${Date.now()}.yaml`);
        
        await tx.writeFile('system/config/redis.yaml', `
production:
  cluster:
    - host: redis1.example.com
      port: 6379
    - host: redis2.example.com
      port: 6379
    - host: redis3.example.com
      port: 6379
  database: 0
  timeout: 10
  cluster_mode: true

staging:
  host: staging-redis.example.com
  port: 6379
  database: 1
  timeout: 5
  cluster_mode: false
`);
        
        // 変更ログを追記
        const existingLog = await tx.readFile('system/config/changes.log');
        await tx.writeFile('system/config/changes.log', existingLog + `
${new Date().toISOString()} Redis configuration updated
- Migrated production to cluster mode
- Added multiple Redis nodes
- Increased timeout values
`);
      });

      // 段階3: 新機能とセキュリティ強化
      await txManager.run(async (tx) => {
        await tx.cp('system/config/app.yaml', `system/backup/app-backup-${Date.now()}.yaml`);
        
        await tx.writeFile('system/config/app.yaml', `
app:
  name: MyApplication
  version: 2.0.0        # バージョンアップ
  debug: false
  log_level: info
  max_request_size: 10MB  # 追加

security:
  jwt_secret: enhanced_prod_secret_key_v2  # 更新
  session_timeout: 7200   # 延長
  max_login_attempts: 3   # 厳格化
  password_policy:        # 追加
    min_length: 12
    require_special: true
    require_numbers: true
  rate_limiting:          # 追加
    requests_per_minute: 100
    burst_size: 20

features:
  email_notifications: true
  file_upload: true
  analytics: true
  real_time_chat: true    # 新機能
  advanced_search: true   # 新機能
  audit_logging: true     # 新機能

monitoring:               # 新セクション
  enabled: true
  metrics_endpoint: /metrics
  health_check_endpoint: /health
  prometheus_enabled: true
`);
        
        // 最終変更ログ
        const existingLog = await tx.readFile('system/config/changes.log');
        await tx.writeFile('system/config/changes.log', existingLog + `
${new Date().toISOString()} Application configuration updated
- Upgraded to version 2.0.0
- Enhanced security policies
- Added new features: real_time_chat, advanced_search, audit_logging
- Added monitoring configuration
- Updated JWT secret and security settings
`);
        
        // 設定検証スクリプト
        await tx.writeFile('system/validate-config.sh', `#!/bin/bash
echo "Validating system configuration..."

# Check database connectivity
echo "Testing database connection..."

# Check Redis cluster
echo "Testing Redis cluster..."

# Validate app configuration
echo "Validating app settings..."

echo "Configuration validation completed successfully"
`);
      });

      // 最終確認とドキュメント生成
      await txManager.run(async (tx) => {
        // 設定概要レポート
        const configSummary = {
          update_completed_at: new Date().toISOString(),
          app_version: '2.0.0',
          database: {
            production_pool_size: 20,
            ssl_enabled: true
          },
          redis: {
            cluster_mode: true,
            nodes_count: 3
          },
          new_features: [
            'real_time_chat',
            'advanced_search',
            'audit_logging'
          ],
          security_enhancements: [
            'enhanced_password_policy',
            'rate_limiting',
            'updated_jwt_secret'
          ],
          backup_files: 3
        };
        
        await tx.writeFile('system/config-update-summary.json', JSON.stringify(configSummary, null, 2));
        
        // README更新
        await tx.writeFile('system/README.md', `
# System Configuration

## Version 2.0.0

### Recent Updates
- Database connection pooling optimized
- Redis cluster mode enabled
- Enhanced security policies
- New application features enabled
- Monitoring and metrics configured

### Configuration Files
- \`config/database.yaml\` - Database connections
- \`config/redis.yaml\` - Redis cluster configuration
- \`config/app.yaml\` - Application settings

### Backups
All configuration backups are stored in \`backup/\` directory.

### Validation
Run \`./validate-config.sh\` to validate current configuration.
`);
      });

      // 検証
      const summary = JSON.parse(await fs.readFile(path.join(testDir, 'system/config-update-summary.json'), 'utf-8'));
      expect(summary.app_version).toBe('2.0.0');
      expect(summary.new_features).toHaveLength(3);

      const appConfig = await fs.readFile(path.join(testDir, 'system/config/app.yaml'), 'utf-8');
      expect(appConfig).toContain('version: 2.0.0');
      expect(appConfig).toContain('real_time_chat: true');

      const changesLog = await fs.readFile(path.join(testDir, 'system/config/changes.log'), 'utf-8');
      expect(changesLog).toContain('Database configuration updated');
      expect(changesLog).toContain('Redis configuration updated');
      expect(changesLog).toContain('Application configuration updated');
    });
  });
});
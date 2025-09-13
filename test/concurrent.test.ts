// test/concurrent.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src';

const TEST_DIR = path.join(process.cwd(), 'test-data-concurrent');
const BASE_DIR = path.join(TEST_DIR, 'workspace');

describe('tx-fs Concurrent Tests', () => {
  beforeEach(async () => {
    // テスト用ディレクトリを作成
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.mkdir(BASE_DIR, { recursive: true });
  });

  afterEach(async () => {
    // テスト後のクリーンアップ - 少し待ってから削除
    // 並行トランザクションが完全に終了するのを待つ
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (e) {
      // まだファイルが使用中の場合は再試行
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        await fs.rm(TEST_DIR, { recursive: true, force: true });
      } catch (e2) {
        console.warn('Failed to cleanup test directory:', e2);
        // 無視
      }
    }
  });

  it('異なるファイルへの並行書き込みを処理できる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    // 複数のトランザクションを並行実行
    const promises = Array.from({ length: 5 }, (_, i) => 
      txManager.run(async (tx) => {
        const filename = `concurrent-${i}.txt`;
        const content = `Content from transaction ${i}`;
        await tx.writeFile(filename, content);
        return { filename, content };
      })
    );

    const results = await Promise.all(promises);

    // すべてのファイルが正しく作成されていることを確認
    for (const { filename, content } of results) {
      const filePath = path.join(BASE_DIR, filename);
      const actualContent = await fs.readFile(filePath, 'utf-8');
      expect(actualContent).toBe(content);
    }
  });

  it('適切なロックで同じファイルへの並行書き込みを処理できる', async () => {
    const txManager = createTxFileManager({ 
      baseDir: BASE_DIR,
      lockTimeout: 5000 // 5秒のタイムアウト
    });
    await txManager.initialize();

    const filename = 'shared-file.txt';
    const transactionCount = 3;
    
    // 複数のトランザクションが同じファイルに書き込もうとする
    const promises = Array.from({ length: transactionCount }, (_, i) => 
      txManager.run(async (tx) => {
        // 各トランザクションが一意の内容を書き込む
        const content = `Transaction ${i} was here at ${Date.now()}`;
        await tx.writeFile(filename, content);
        return content;
      })
    );

    const results = await Promise.all(promises);

    // ファイルが存在し、いずれかのトランザクションの内容が書かれていることを確認
    const filePath = path.join(BASE_DIR, filename);
    const finalContent = await fs.readFile(filePath, 'utf-8');
    
    // 結果のいずれかと一致するはず
    expect(results).toContain(finalContent);
  });

  it('並行ディレクトリ操作を処理できる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    // 複数のトランザクションがそれぞれ異なるディレクトリを作成
    const promises = Array.from({ length: 3 }, (_, i) => 
      txManager.run(async (tx) => {
        const dirName = `dir-${i}`;
        const fileName = `file-${i}.txt`;
        
        await tx.mkdir(dirName);
        await tx.writeFile(`${dirName}/${fileName}`, `Content for ${dirName}`);
        
        return { dirName, fileName };
      })
    );

    const results = await Promise.all(promises);

    // すべてのディレクトリとファイルが作成されていることを確認
    for (const { dirName, fileName } of results) {
      const dirPath = path.join(BASE_DIR, dirName);
      const filePath = path.join(dirPath, fileName);
      
      await expect(fs.access(dirPath)).resolves.not.toThrow();
      
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe(`Content for ${dirName}`);
    }
  });

  it('成功と失敗が混在するシナリオを処理できる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    // 事前にファイルを作成
    await fs.writeFile(path.join(BASE_DIR, 'shared.txt'), 'original content');

    // 成功するトランザクションと失敗するトランザクションを混在
    const promises = [
      // 成功するトランザクション
      txManager.run(async (tx) => {
        await tx.writeFile('success-1.txt', 'success 1');
        return 'success-1';
      }),
      
      // 失敗するトランザクション
      txManager.run(async (tx) => {
        await tx.writeFile('failure-1.txt', 'this should be rolled back');
        await tx.writeFile('shared.txt', 'this should also be rolled back');
        throw new Error('Intentional failure');
      }).catch(err => err.message),
      
      // 成功するトランザクション
      txManager.run(async (tx) => {
        await tx.writeFile('success-2.txt', 'success 2');
        return 'success-2';
      }),
    ];

    const results = await Promise.all(promises);

    // 結果の確認
    expect(results[0]).toBe('success-1');
    expect(results[1]).toBe('Intentional failure');
    expect(results[2]).toBe('success-2');

    // 成功したファイルは存在する
    const success1 = await fs.readFile(path.join(BASE_DIR, 'success-1.txt'), 'utf-8');
    expect(success1).toBe('success 1');
    
    const success2 = await fs.readFile(path.join(BASE_DIR, 'success-2.txt'), 'utf-8');
    expect(success2).toBe('success 2');

    // 失敗したトランザクションのファイルは存在しない
    await expect(fs.access(path.join(BASE_DIR, 'failure-1.txt'))).rejects.toThrow();

    // 共有ファイルは元の内容のまま
    const sharedContent = await fs.readFile(path.join(BASE_DIR, 'shared.txt'), 'utf-8');
    expect(sharedContent).toBe('original content');
  });

  it('並行書き込み中の読み取り操作を処理できる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    // 事前にファイルを作成
    const initialContent = 'Initial content';
    await fs.writeFile(path.join(BASE_DIR, 'read-test.txt'), initialContent);

    const promises = [
      // 書き込みトランザクション
      txManager.run(async (tx) => {
        await new Promise(resolve => setTimeout(resolve, 100)); // 少し待機
        await tx.writeFile('read-test.txt', 'Modified content');
        return 'write-complete';
      }),
      
      // 読み取りトランザクション（書き込み前に実行）
      txManager.run(async (tx) => {
        const content = await tx.readFile('read-test.txt');
        return content.toString();
      }),
      
      // 読み取りトランザクション（書き込み後に実行）
      new Promise(resolve => setTimeout(() => {
        txManager.run(async (tx) => {
          const content = await tx.readFile('read-test.txt');
          resolve(content.toString());
        });
      }, 200)),
    ];

    const results = await Promise.all(promises);

    expect(results[0]).toBe('write-complete');
    // 最初の読み取りは初期内容またはコミット後の内容
    expect([initialContent, 'Modified content']).toContain(results[1]);
  });
});
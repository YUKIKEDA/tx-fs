// test/rollback.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src';

const TEST_DIR = path.join(process.cwd(), 'test-data-rollback');
const BASE_DIR = path.join(TEST_DIR, 'workspace');

describe('tx-fs Rollback Tests', () => {
  beforeEach(async () => {
    // テスト用ディレクトリを作成
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.mkdir(BASE_DIR, { recursive: true });
  });

  afterEach(async () => {
    // テスト後のクリーンアップ
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (e) {
      // 無視
    }
  });

  it('トランザクションが失敗した時に変更をロールバックできる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    // 事前にファイルを作成
    await fs.writeFile(path.join(BASE_DIR, 'existing.txt'), 'original content');

    try {
      await txManager.run(async (tx) => {
        // 既存ファイルを変更
        await tx.writeFile('existing.txt', 'modified content');
        
        // 新しいファイルを作成
        await tx.writeFile('new.txt', 'new content');
        
        // ディレクトリを作成
        await tx.mkdir('newdir');
        await tx.writeFile('newdir/file.txt', 'directory content');
        
        // 意図的にエラーを発生させる
        throw new Error('Transaction failed');
      });
    } catch (error) {
      expect(error.message).toBe('Transaction failed');
    }

    // 既存ファイルが元の内容のままであることを確認
    const existingContent = await fs.readFile(path.join(BASE_DIR, 'existing.txt'), 'utf-8');
    expect(existingContent).toBe('original content');

    // 新しいファイルが作成されていないことを確認
    await expect(fs.access(path.join(BASE_DIR, 'new.txt'))).rejects.toThrow();

    // 新しいディレクトリが作成されていないことを確認
    try {
      await fs.access(path.join(BASE_DIR, 'newdir'));
      console.log('DEBUG: newdir exists when it should not');
      const files = await fs.readdir(path.join(BASE_DIR, 'newdir'));
      console.log('DEBUG: newdir contents:', files);
    } catch (e) {
      console.log('DEBUG: newdir does not exist (good)');
    }
    await expect(fs.access(path.join(BASE_DIR, 'newdir'))).rejects.toThrow();
  });

  it('ロールバック時に他のファイルに影響しない', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    // 複数のファイルを事前作成
    await fs.writeFile(path.join(BASE_DIR, 'file1.txt'), 'content1');
    await fs.writeFile(path.join(BASE_DIR, 'file2.txt'), 'content2');
    await fs.writeFile(path.join(BASE_DIR, 'file3.txt'), 'content3');

    try {
      await txManager.run(async (tx) => {
        // 一部のファイルのみ変更
        await tx.writeFile('file1.txt', 'modified1');
        await tx.writeFile('file3.txt', 'modified3');
        
        // file2は変更しない
        
        // エラーを発生させる
        throw new Error('Rollback test');
      });
    } catch (error) {
      expect(error.message).toBe('Rollback test');
    }

    // すべてのファイルが元の内容のままであることを確認
    const content1 = await fs.readFile(path.join(BASE_DIR, 'file1.txt'), 'utf-8');
    const content2 = await fs.readFile(path.join(BASE_DIR, 'file2.txt'), 'utf-8');
    const content3 = await fs.readFile(path.join(BASE_DIR, 'file3.txt'), 'utf-8');

    expect(content1).toBe('content1');
    expect(content2).toBe('content2');
    expect(content3).toBe('content3');
  });

  it('ファイル削除をロールバックできる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    // 削除対象ファイル・ディレクトリを事前作成
    await fs.writeFile(path.join(BASE_DIR, 'delete-me.txt'), 'to be deleted');
    await fs.mkdir(path.join(BASE_DIR, 'delete-dir'));
    await fs.writeFile(path.join(BASE_DIR, 'delete-dir', 'nested.txt'), 'nested content');

    try {
      await txManager.run(async (tx) => {
        // ファイルとディレクトリを削除
        await tx.rm('delete-me.txt');
        await tx.rm('delete-dir', { recursive: true });
        
        // 新しいファイルも作成
        await tx.writeFile('new-file.txt', 'new content');
        
        // エラーを発生させてロールバック
        throw new Error('Rollback deletion');
      });
    } catch (error) {
      expect(error.message).toBe('Rollback deletion');
    }

    // 削除対象ファイル・ディレクトリが存在することを確認
    const fileContent = await fs.readFile(path.join(BASE_DIR, 'delete-me.txt'), 'utf-8');
    expect(fileContent).toBe('to be deleted');

    const nestedContent = await fs.readFile(path.join(BASE_DIR, 'delete-dir', 'nested.txt'), 'utf-8');
    expect(nestedContent).toBe('nested content');

    // 新しいファイルが作成されていないことを確認
    await expect(fs.access(path.join(BASE_DIR, 'new-file.txt'))).rejects.toThrow();
  });

  it('ネストしたトランザクションの失敗を処理できる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    // 事前ファイル作成
    await fs.writeFile(path.join(BASE_DIR, 'base.txt'), 'base content');

    try {
      await txManager.run(async (tx) => {
        // 段階的にファイルを作成・変更
        await tx.writeFile('step1.txt', 'step 1 complete');
        
        await tx.writeFile('base.txt', 'modified in step 2');
        await tx.writeFile('step2.txt', 'step 2 complete');
        
        await tx.mkdir('step3-dir');
        await tx.writeFile('step3-dir/file.txt', 'step 3 complete');
        
        // 最後の段階でエラー
        throw new Error('Failed at final step');
      });
    } catch (error) {
      expect(error.message).toBe('Failed at final step');
    }

    // すべての変更がロールバックされていることを確認
    const baseContent = await fs.readFile(path.join(BASE_DIR, 'base.txt'), 'utf-8');
    expect(baseContent).toBe('base content');

    await expect(fs.access(path.join(BASE_DIR, 'step1.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(BASE_DIR, 'step2.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(BASE_DIR, 'step3-dir'))).rejects.toThrow();
  });
});
// test/basic.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src';

const TEST_DIR = path.join(process.cwd(), 'test-data');
const BASE_DIR = path.join(TEST_DIR, 'workspace');

describe('tx-fs Basic Tests', () => {
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

  it('tx-fsマネージャーを初期化できる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await expect(txManager.initialize()).resolves.not.toThrow();

    // .txディレクトリが作成されているかチェック
    const txDir = path.join(BASE_DIR, '.tx');
    await expect(fs.access(txDir)).resolves.not.toThrow();
    await expect(fs.access(path.join(txDir, 'staging'))).resolves.not.toThrow();
    await expect(fs.access(path.join(txDir, 'journal'))).resolves.not.toThrow();
    await expect(fs.access(path.join(txDir, 'locks'))).resolves.not.toThrow();
  });

  it('トランザクション内でファイルの書き込みと読み取りができる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    const result = await txManager.run(async (tx) => {
      // ファイルに書き込み
      await tx.writeFile('test.txt', 'Hello World');
      
      // 同じトランザクション内で読み取り
      const content = await tx.readFile('test.txt');
      return content.toString();
    });

    expect(result).toBe('Hello World');

    // ファイルが実際に作成されているかチェック
    const filePath = path.join(BASE_DIR, 'test.txt');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('Hello World');
  });

  it('ファイルに追記できる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    await txManager.run(async (tx) => {
      await tx.writeFile('append.txt', 'Hello ');
      await tx.appendFile('append.txt', 'World!');
    });

    const content = await fs.readFile(path.join(BASE_DIR, 'append.txt'), 'utf-8');
    expect(content).toBe('Hello World!');
  });

  it('ディレクトリを作成できる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    await txManager.run(async (tx) => {
      await tx.mkdir('test-dir');
      await tx.writeFile('test-dir/file.txt', 'content');
    });

    const dirPath = path.join(BASE_DIR, 'test-dir');
    const filePath = path.join(dirPath, 'file.txt');
    
    await expect(fs.access(dirPath)).resolves.not.toThrow();
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('content');
  });

  it('ファイルの存在確認ができる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    const results = await txManager.run(async (tx) => {
      // 存在しないファイル
      const nonExistent = await tx.exists('does-not-exist.txt');
      
      // ファイル作成
      await tx.writeFile('exists.txt', 'content');
      
      // 作成したファイル
      const existent = await tx.exists('exists.txt');
      
      return { nonExistent, existent };
    });

    expect(results.nonExistent).toBe(false);
    expect(results.existent).toBe(true);
  });

  it('ファイルとディレクトリを削除できる', async () => {
    const txManager = createTxFileManager({ baseDir: BASE_DIR });
    await txManager.initialize();

    // ファイルとディレクトリを事前作成
    await fs.writeFile(path.join(BASE_DIR, 'to-delete.txt'), 'content');
    await fs.mkdir(path.join(BASE_DIR, 'to-delete-dir'), { recursive: true });
    await fs.writeFile(path.join(BASE_DIR, 'to-delete-dir', 'file.txt'), 'content');

    await txManager.run(async (tx) => {
      await tx.rm('to-delete.txt');
      await tx.rm('to-delete-dir', { recursive: true });
    });

    // ファイルとディレクトリが削除されているかチェック
    await expect(fs.access(path.join(BASE_DIR, 'to-delete.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(BASE_DIR, 'to-delete-dir'))).rejects.toThrow();
  });
});
// test/debug.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lock, unlock } from 'proper-lockfile';
import * as fs from 'fs/promises';
import * as path from 'path';

const TEST_DIR = path.join(process.cwd(), 'test-locks');

describe('proper-lockfile debug', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('proper-lockfileの基本的な使用方法で動作する', async () => {
    // 先に実際のファイルを作成してからロックする方式を試す
    const targetFile = path.join(TEST_DIR, 'target.txt');
    await fs.writeFile(targetFile, 'test content');

    try {
      console.log('Locking file:', targetFile);

      // ロックを取得
      await lock(targetFile);
      console.log('Lock acquired');

      // ロックファイルの存在確認（.lockが追加される）
      const lockFile = targetFile + '.lock';
      await expect(fs.access(lockFile)).resolves.not.toThrow();
      console.log('Lock file exists:', lockFile);

      // ロックを解放
      await unlock(targetFile);
      console.log('Lock released');
    } catch (error) {
      console.error('Lock error:', error);
      throw error;
    }
  });

  it('ディレクトリをロック対象として動作する', async () => {
    const lockDir = path.join(TEST_DIR, 'lockdir');
    await fs.mkdir(lockDir);

    try {
      await lock(lockDir);
      await unlock(lockDir);
    } catch (error) {
      console.error('Directory lock error:', error);
      throw error;
    }
  });
});

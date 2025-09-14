import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTxFileManager } from '../src/index';

describe('tx-fs リカバリーテスト', () => {
  const testDir = path.join(__dirname, 'test-recovery');
  let txManager: ReturnType<typeof createTxFileManager>;

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore if directory doesn't exist
    }

    // Create fresh test directory
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it('起動時に不完全なトランザクションからリカバリーする', async () => {
    // First, create a transaction manager and start a transaction
    txManager = createTxFileManager({ baseDir: testDir });
    await txManager.initialize();

    // Create some test data
    await fs.writeFile(path.join(testDir, 'existing.txt'), 'existing content');

    // Start a transaction but don't complete it by simulating a crash
    let txState: any;
    let stagingDir: string;

    // We need to access internal APIs for this test, so we'll simulate
    // an incomplete transaction by creating journal and staging files manually
    const txDir = path.join(testDir, '.tx');
    const journalDir = path.join(txDir, 'journal');
    const stagingRootDir = path.join(txDir, 'staging');

    // Create a fake transaction ID
    const txId = 'test-tx-123';
    stagingDir = path.join(stagingRootDir, txId);

    // Create staging directory and files
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.mkdir(path.join(stagingDir, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(stagingDir, 'new-file.txt'), 'new content');

    // Create a journal in IN_PROGRESS state (should be rolled back)
    const incompleteJournal = {
      id: txId,
      status: 'IN_PROGRESS',
      operations: [{ op: 'WRITE', path: 'new-file.txt' }],
      snapshots: {},
    };

    await fs.writeFile(
      path.join(journalDir, `${txId}.json`),
      JSON.stringify(incompleteJournal, null, 2),
    );

    // Create another transaction in PREPARED state (should be rolled forward)
    const preparedTxId = 'test-tx-456';
    const preparedStagingDir = path.join(stagingRootDir, preparedTxId);

    await fs.mkdir(preparedStagingDir, { recursive: true });
    await fs.writeFile(
      path.join(preparedStagingDir, 'prepared-file.txt'),
      'prepared content',
    );

    const preparedJournal = {
      id: preparedTxId,
      status: 'PREPARED',
      operations: [{ op: 'WRITE', path: 'prepared-file.txt' }],
      snapshots: {},
    };

    await fs.writeFile(
      path.join(journalDir, `${preparedTxId}.json`),
      JSON.stringify(preparedJournal, null, 2),
    );

    // Now create a new transaction manager to trigger recovery
    const recoveryTxManager = createTxFileManager({ baseDir: testDir });
    await recoveryTxManager.initialize();

    // Check recovery results
    // The IN_PROGRESS transaction should be rolled back (file should not exist)
    await expect(
      fs.access(path.join(testDir, 'new-file.txt')),
    ).rejects.toThrow();

    // The PREPARED transaction should be rolled forward (file should exist)
    const preparedContent = await fs.readFile(
      path.join(testDir, 'prepared-file.txt'),
      'utf-8',
    );
    expect(preparedContent).toBe('prepared content');

    // Original file should still exist
    const existingContent = await fs.readFile(
      path.join(testDir, 'existing.txt'),
      'utf-8',
    );
    expect(existingContent).toBe('existing content');

    // Journals should be cleaned up
    await expect(
      fs.access(path.join(journalDir, `${txId}.json`)),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(journalDir, `${preparedTxId}.json`)),
    ).rejects.toThrow();

    // Staging directories should be cleaned up
    await expect(fs.access(stagingDir)).rejects.toThrow();
    await expect(fs.access(preparedStagingDir)).rejects.toThrow();
  });

  it('COMMITTEDステータスでのリカバリーを処理する（クリーンアップのみ）', async () => {
    txManager = createTxFileManager({ baseDir: testDir });
    await txManager.initialize();

    const txDir = path.join(testDir, '.tx');
    const journalDir = path.join(txDir, 'journal');
    const stagingRootDir = path.join(txDir, 'staging');

    // Create a transaction in COMMITTED state
    const txId = 'test-tx-committed';
    const stagingDir = path.join(stagingRootDir, txId);

    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(
      path.join(stagingDir, 'leftover-file.txt'),
      'leftover content',
    );

    const committedJournal = {
      id: txId,
      status: 'COMMITTED',
      operations: [{ op: 'WRITE', path: 'some-file.txt' }],
      snapshots: {},
    };

    await fs.writeFile(
      path.join(journalDir, `${txId}.json`),
      JSON.stringify(committedJournal, null, 2),
    );

    // Trigger recovery
    const recoveryTxManager = createTxFileManager({ baseDir: testDir });
    await recoveryTxManager.initialize();

    // Journal and staging should be cleaned up
    await expect(
      fs.access(path.join(journalDir, `${txId}.json`)),
    ).rejects.toThrow();
    await expect(fs.access(stagingDir)).rejects.toThrow();
  });

  it('ROLLED_BACKステータスでのリカバリーを処理する（クリーンアップのみ）', async () => {
    txManager = createTxFileManager({ baseDir: testDir });
    await txManager.initialize();

    const txDir = path.join(testDir, '.tx');
    const journalDir = path.join(txDir, 'journal');
    const stagingRootDir = path.join(txDir, 'staging');

    // Create a transaction in ROLLED_BACK state
    const txId = 'test-tx-rolledback';
    const stagingDir = path.join(stagingRootDir, txId);

    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(
      path.join(stagingDir, 'leftover-file.txt'),
      'leftover content',
    );

    const rolledBackJournal = {
      id: txId,
      status: 'ROLLED_BACK',
      operations: [{ op: 'WRITE', path: 'some-file.txt' }],
      snapshots: {},
    };

    await fs.writeFile(
      path.join(journalDir, `${txId}.json`),
      JSON.stringify(rolledBackJournal, null, 2),
    );

    // Trigger recovery
    const recoveryTxManager = createTxFileManager({ baseDir: testDir });
    await recoveryTxManager.initialize();

    // Journal and staging should be cleaned up
    await expect(
      fs.access(path.join(journalDir, `${txId}.json`)),
    ).rejects.toThrow();
    await expect(fs.access(stagingDir)).rejects.toThrow();
  });

  it('リカバリーエラーを適切に処理する', async () => {
    txManager = createTxFileManager({ baseDir: testDir });
    await txManager.initialize();

    const txDir = path.join(testDir, '.tx');
    const journalDir = path.join(txDir, 'journal');

    // Create an invalid journal file
    await fs.writeFile(
      path.join(journalDir, 'invalid-tx.json'),
      'invalid json content',
    );

    // Recovery should not throw and should continue initialization
    const recoveryTxManager = createTxFileManager({ baseDir: testDir });
    await expect(recoveryTxManager.initialize()).resolves.not.toThrow();

    // Manager should still be functional
    await recoveryTxManager.run(async (tx) => {
      await tx.writeFile('test.txt', 'test content');
    });

    const content = await fs.readFile(path.join(testDir, 'test.txt'), 'utf-8');
    expect(content).toBe('test content');
  });

  it('ジャーナルが存在しない場合のリカバリーを処理する', async () => {
    txManager = createTxFileManager({ baseDir: testDir });

    // Initialize should work fine with no existing journals
    await expect(txManager.initialize()).resolves.not.toThrow();

    // Manager should be functional
    await txManager.run(async (tx) => {
      await tx.writeFile('test.txt', 'test content');
    });

    const content = await fs.readFile(path.join(testDir, 'test.txt'), 'utf-8');
    expect(content).toBe('test content');
  });
});

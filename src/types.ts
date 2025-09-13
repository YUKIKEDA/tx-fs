// src/types.ts

// アプリケーション全体で共有される不変のコンテキスト
export interface AppContext {
  readonly baseDir: string;
  readonly txDir: string;
  readonly lockManager: LockManager;
  readonly journalManager: JournalManager;
}

// トランザクションの状態を表すオブジェクト
export interface TxState {
  readonly id: string;
  readonly stagingDir: string;
  journal: Journal;
  acquiredLocks: Set<string>;
  temporaryResources: Set<string>; // ロック取得のために一時作成したファイル/ディレクトリ
}

// ジャーナル（トランザクションの状態と操作履歴）
export interface Journal {
  readonly id: string;
  status: 'IN_PROGRESS' | 'PREPARED' | 'COMMITTED' | 'ROLLED_BACK';
  operations: JournalOperation[];
  snapshots: { [originalPath: string]: string };
}

// ジャーナルに記録される操作の種類
export type JournalOperation =
  | { op: 'WRITE'; path: string }
  | { op: 'RM'; path: string }
  | { op: 'MKDIR'; path: string }
  | { op: 'RENAME'; from: string; to: string }
  | { op: 'CP'; from: string; to: string };

// ロック管理の責務を持つオブジェクト
export interface LockManager {
  acquireSharedLock(resourcePath: string): Promise<string | undefined>;
  acquireExclusiveLock(resourcePath: string): Promise<string | undefined>;
  releaseAll(resourcePaths: Set<string>): Promise<void>;
}

// ジャーナル管理の責務を持つオブジェクト
export interface JournalManager {
  write(journal: Journal, options?: { sync?: boolean }): Promise<void>;
  read(txId: string): Promise<Journal | null>;
  delete(txId: string): Promise<void>;
  listAllTxIds(): Promise<string[]>;
}

// トランザクション用のファイル操作API
export interface TxHandle {
  readFile(filePath: string, encoding?: BufferEncoding): Promise<string | Buffer>;
  writeFile(filePath: string, data: Buffer | string): Promise<void>;
  appendFile(filePath: string, data: Buffer | string): Promise<void>;
  rm(targetPath: string, options?: { recursive?: boolean }): Promise<void>;
  mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>;
  exists(targetPath: string): Promise<boolean>;
  rename(oldPath: string, newPath: string): Promise<void>;
  cp(sourcePath: string, destPath: string, options?: { recursive?: boolean }): Promise<void>;
  snapshotDir(dirPath: string): Promise<void>;
}

// ライブラリのメインエントリーポイントの設定
export interface TxFileManagerOptions {
  baseDir: string;
  txDirName?: string;
  lockTimeout?: number;
}

// メインのライブラリAPI
export interface TxFileManager {
  initialize(): Promise<void>;
  run<T>(callback: (tx: TxHandle) => Promise<T>): Promise<T>;
}
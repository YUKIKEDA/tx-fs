# tx-fs

**tx-fs** is a transactional file system library for Node.js that provides ACID properties for file and directory operations. It supports persistent enlistment, multi-thread safety, and Read Committed isolation level.

## Features

- **Transactional Operations**: All file operations are performed within transactions with commit/rollback support
- **Read Committed Isolation**: Other transactions can only see committed changes
- **Multi-thread Safe**: Uses file-based locking to coordinate access across threads and processes
- **Crash Recovery**: Persistent journaling with automatic recovery on restart
- **Atomic Operations**: All changes are applied atomically during commit
- **Function-based API**: Modern TypeScript API without classes

## Installation

```bash
npm install tx-fs
```

## Quick Start

```typescript
import { createTxFileManager } from 'tx-fs';

// Initialize the transaction manager
const txManager = createTxFileManager({
  baseDir: '/path/to/your/project'
});

// Initialize the library (creates .tx directory and sets up recovery)
await txManager.initialize();

// Perform transactional operations
await txManager.run(async (tx) => {
  // Write a file
  await tx.writeFile('example.txt', 'Hello World');
  
  // Read the file
  const content = await tx.readFile('example.txt');
  console.log(content.toString()); // "Hello World"
  
  // Create a directory
  await tx.mkdir('mydir');
  
  // Write another file
  await tx.writeFile('mydir/data.txt', 'Some data');
  
  // All operations will be committed together
  // If any operation fails, all changes will be rolled back
});
```

## Configuration

```typescript
const txManager = createTxFileManager({
  baseDir: '/path/to/your/project',    // Base directory for file operations
  txDirName: '.tx',                    // Name of transaction metadata directory (default: '.tx')
  lockTimeout: 10000                   // Lock acquisition timeout in milliseconds (default: 10000)
});
```

## API Reference

### Transaction Operations

Once inside a transaction scope, you have access to these operations:

#### `readFile(filePath: string): Promise<Buffer>`
Reads a file from the filesystem or staging area.

#### `writeFile(filePath: string, data: Buffer | string): Promise<void>`
Writes data to a file. Creates the file if it doesn't exist.

#### `appendFile(filePath: string, data: Buffer | string): Promise<void>`
Appends data to an existing file or creates a new file.

#### `rm(targetPath: string, options?: { recursive?: boolean }): Promise<void>`
Removes a file or directory.

#### `mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void>`
Creates a directory.

#### `exists(targetPath: string): Promise<boolean>`
Checks if a file or directory exists.

## Transaction Guarantees

### ACID Properties

- **Atomicity**: All operations within a transaction are committed together or rolled back together
- **Consistency**: File system state remains consistent across transaction boundaries
- **Isolation**: Read Committed isolation level - transactions only see committed changes from other transactions
- **Durability**: Committed changes are persisted to disk and survive crashes

### Locking Strategy

- **File Operations** (`readFile`, `writeFile` on existing files): Lock the file itself
- **Directory Structure Changes** (file creation, deletion, `mkdir`): Lock the parent directory
- **Read Operations**: Use shared locks (multiple readers allowed)
- **Write Operations**: Use exclusive locks (single writer only)

### Recovery

On startup, the library automatically scans for incomplete transactions and either:
- **Rolls back** transactions that hadn't reached the prepared state
- **Rolls forward** transactions that were prepared but not completed

## Directory Structure

The library creates a `.tx` directory in your base directory:

```
your-project/
├── .tx/
│   ├── journal/     # Transaction journals for recovery
│   ├── staging/     # Staging area for uncommitted changes
│   └── locks/       # Lock files for coordination
└── your-files...
```

## Error Handling

```typescript
try {
  await txManager.run(async (tx) => {
    await tx.writeFile('test.txt', 'data');
    throw new Error('Something went wrong');
  });
} catch (error) {
  // Transaction was automatically rolled back
  // The file 'test.txt' was not created
  console.log('Transaction failed:', error.message);
}
```

## Limitations

- Currently implements basic operations (`readFile`, `writeFile`, `appendFile`, `rm`, `mkdir`, `exists`)
- `rename`, `cp`, and `snapshotDirectory` operations are planned but not yet implemented
- All operations must be performed within the configured `baseDir`
- Cross-filesystem moves are not atomic (Node.js limitation)

## Implementation Details

### Two-Phase Commit

1. **Prepare Phase**: All changes are staged and journal is marked as "PREPARED"
2. **Execute Phase**: Changes are atomically moved from staging to final locations
3. **Cleanup Phase**: Locks are released and temporary files are cleaned up

### Staging Area

All modifications are first written to a staging area (`.tx/staging/<transaction-id>/`). On commit, these changes are atomically moved to their final locations using `fs.rename()` when possible.

## License

ISC

## Contributing

This library is still in early development. Some features mentioned in the design discussions are not yet implemented. Contributions are welcome!
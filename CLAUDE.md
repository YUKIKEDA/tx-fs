# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

tx-fs is a transactional file system library for Node.js that provides ACID properties for file and directory operations. It implements a two-phase commit protocol with persistent journaling and automatic crash recovery.

## Development Commands

### Building and Development
- `npm run build` - Build the project using tsup
- `npm run dev` - Watch mode for development (tsup --watch)
- `npm run prepublishOnly` - Prepare for publishing (runs build)

### Testing
- `npm test` - Run all tests using Vitest
- `npm run coverage` - Run tests with coverage report

### Code Quality
- `npm run lint` - Lint TypeScript files with ESLint
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Format code with Prettier

## Core Architecture

### Transaction Management
The library follows a modular architecture with clear separation of concerns:

- **`index.ts`** - Main entry point and factory function (`createTxFileManager`)
- **`types.ts`** - Core interfaces and type definitions (includes Japanese comments)
- **`transaction.ts`** - Transaction lifecycle management (begin/commit/rollback)
- **`operations.ts`** - File system operations (read/write/mkdir/rm/etc.)
- **`lockManager.ts`** - File-based locking for concurrency control
- **`journalManager.ts`** - Persistent transaction journaling

### Key Components

1. **AppContext**: Immutable application-wide context containing base directory, transaction directory, and manager instances
2. **TxState**: Mutable transaction state tracking staging directory, journal, acquired locks, and temporary resources
3. **Journal**: Records transaction status and operations for crash recovery
4. **Two-Phase Commit**: Prepare phase (staging) → Execute phase (atomic moves) → Cleanup

### Locking Strategy
- File operations: Lock the file itself
- Directory structure changes: Lock the parent directory  
- Read operations: Shared locks (multiple readers)
- Write operations: Exclusive locks (single writer)

### Directory Structure
- `.tx/` - Transaction metadata directory
  - `staging/` - Staging area for uncommitted changes
  - `journal/` - Transaction journals for recovery
  - `locks/` - Lock files for coordination

## Testing Architecture

Test files in `test/` directory:
- `basic.test.ts` - Basic functionality tests
- `concurrent.test.ts` - Concurrency and locking tests
- `rollback.test.ts` - Transaction rollback scenarios
- `debug.test.ts` - Debugging utilities

## Configuration

- **TypeScript**: ES2020 target, strict mode enabled
- **ESLint**: TypeScript-specific rules with Prettier integration
- **Prettier**: Single quotes, semicolons, trailing commas
- **Build**: tsup for bundling with both CJS and ESM outputs
- **CI**: GitHub Actions testing Node.js 18.x and 20.x

## Important Implementation Notes

- The library requires explicit initialization via `initialize()` before use
- All operations must be performed within the configured `baseDir`
- Some operations (`rename`, `cp`, `snapshotDirectory`) are planned but not yet implemented
- Recovery process is marked as TODO and not fully implemented
- Uses `proper-lockfile` for file-based locking across processes
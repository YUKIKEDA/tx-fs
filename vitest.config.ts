import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // テスト実行設定
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'coverage/**',
        '**/*.d.ts',
        // テスト内で作成される動的ファイルを除外
        'test/test-*/**',
        '**/spec/**',
        '**/tests/**',
        // 具体的なパスも除外
        'test/**/spec/**',
        'test/**/tests/**',
        // 動的に作成されるファイルパターンも除外
        '**/*.spec.js',
        '**/*.test.js',
      ],
      // カバレッジ計算時に含めるファイルを明示的に指定
      include: [
        'src/**/*.ts',
      ],
    },
  },
})
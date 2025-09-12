import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'], // ライブラリのエントリーポイント
  format: ['cjs', 'esm'],  // CJSとESMの両方で出力
  dts: true,               // 型定義ファイルを生成
  splitting: false,
  sourcemap: true,
  clean: true,             // ビルド前にdistディレクトリをクリーンアップ
});
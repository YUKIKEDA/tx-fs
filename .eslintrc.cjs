module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier', // Prettierとの競合を避ける
  ],
  plugins: ['@typescript-eslint/eslint-plugin'],
  env: {
    node: true,
  },
  rules: {
    // プロジェクト固有のルールを追加
  },
};
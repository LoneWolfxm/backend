// @ts-check
const eslint = require('@eslint/js')
const tseslint = require('typescript-eslint')
const prettier = require('eslint-config-prettier')

module.exports = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'openapi.json'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },
  {
    files: ['scripts/**/*.ts', 'prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  }
)

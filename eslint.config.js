// SPDX-FileCopyrightText: 2026 The nextcloud-craftsuite-layer contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';

export default [
  {
    ignores: ['node_modules/', '.craft-builds/', 'test-results/', 'playwright-report/', 'blob-report/',
      'craftsuite_layer/js/', 'craftsuite_layer/l10n/', 'craftsuite_layer/vendor/', 'craftsuite_layer/build/'],
  },
  js.configs.recommended,
  {
    // Translators and test pages run as classic scripts in the browser.
    files: ['translators/**/*.js', 'tests/e2e/host/**/*.js', 'tests/e2e/stub-app/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    // The Nextcloud app's front end (bundled by esbuild to craftsuite_layer/js/, see its build.mjs).
    files: ['craftsuite_layer/src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './craftsuite_layer/tsconfig.json', tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-control-regex': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
  {
    // Tests: a forgotten await is the most common cause of flaky browser tests.
    files: ['tests/e2e/**/*.ts'],
    ...playwright.configs['flat/recommended'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tests/e2e/tsconfig.json', tsconfigRootDir: import.meta.dirname },
      // Callbacks passed to page.evaluate() run in the browser.
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, ...playwright.configs['flat/recommended'].plugins },
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      // TypeScript checks these itself; the core rules do not understand type positions.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
];

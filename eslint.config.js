// ESLint flat config. typescript-eslint recommended everywhere, plus the project rule from
// ultraplan.html (risk "accidental getImageData in a hot path"): the terrain mask is the only
// collision source of truth, so getImageData is banned under src/sim and src/terrain. The one
// allowed readback is the PNG level loader (src/terrain/png-level.ts), at load time only.

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const GET_IMAGE_DATA_MESSAGE =
  'getImageData is banned under src/sim and src/terrain: read the Uint8Array mask instead. ' +
  'The only allowed readback is src/terrain/png-level.ts at load time.';

export default defineConfig([
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '.bitacora/**',
      '.claude/**',
      'assets/**',
      'docs/**',
      'loops/**',
      'refs/**',
      'sources/**',
      'wiki/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      // Dropping a field with `const { fuse: _fuse, ...rest } = def` is the idiom for immutable removal.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['sidecar/**/*.ts', 'tools/**/*.ts', 'scripts/**/*.mjs', 'tests/**/*.ts', '*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    name: 'orugas/no-get-image-data-in-hot-paths',
    files: ['src/sim/**/*.ts', 'src/terrain/**/*.ts'],
    ignores: ['src/terrain/png-level.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'MemberExpression[property.name="getImageData"]', message: GET_IMAGE_DATA_MESSAGE },
        { selector: 'Literal[value="getImageData"]', message: GET_IMAGE_DATA_MESSAGE },
        { selector: 'TemplateElement[value.cooked="getImageData"]', message: GET_IMAGE_DATA_MESSAGE },
      ],
    },
  },
]);

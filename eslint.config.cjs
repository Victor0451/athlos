// @ts-check
const tseslint = require('typescript-eslint')
const prettierConfig = require('eslint-config-prettier')

/** @type {import('eslint').Linter.Config[]} */
module.exports = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.cjs',
      '**/*.mjs',
      'eslint.config.cjs',
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  // Web-only guard: callers MUST use the project wrapper
  // (`@/lib/notifications` → `@/components/ui/Toast`) instead of
  // importing sonner directly. The wrapper owns every locked default
  // (position, theme, durations, ARIA role); bypassing it would
  // silently regress the visual / accessibility contract.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'sonner',
              message:
                "Use `import { notify } from '@/lib/notifications'` instead of importing sonner directly. The wrapper at apps/web/src/components/ui/Toast.tsx owns all defaults.",
            },
          ],
        },
      ],
    },
  },
  // The wrapper itself (and its test, which spies on sonner's
  // exports) is the ONLY file allowed to import sonner. Everything
  // else inside apps/web/src must go through `@/lib/notifications`.
  {
    files: ['apps/web/src/components/ui/Toast.tsx', 'apps/web/src/components/ui/Toast.test.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  prettierConfig,
)

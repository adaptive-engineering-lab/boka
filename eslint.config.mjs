import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
      'supabase/.branches/**',
      'supabase/.temp/**',
    ],
  },
  js.configs.recommended,
  {
    // Node scripts and config files: declare the globals they legitimately use.
    files: ['**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // TypeScript resolves identifiers itself and reports genuinely undefined ones as
      // compile errors. Leaving no-undef on for .ts files only produces false positives
      // on ambient globals like `process` and `React`.
      'no-undef': 'off',
    },
  },
  {
    /*
     * Principle II guardrail.
     *
     * The service-role key bypasses RLS entirely, which is where every privacy
     * guarantee in this project lives. `import 'server-only'` is the real barrier —
     * this rule just moves the failure from build time to edit time.
     *
     * Scoped to components and pages, which is where the mistake actually happens.
     * lib/ and route handlers import it legitimately; blocking them everywhere only
     * teaches people to add eslint-disable comments, which is worse than no rule.
     */
    files: ['components/**/*.{ts,tsx}', 'app/**/page.tsx', 'app/**/layout.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase/admin',
              message:
                'The admin client bypasses RLS. Never import it from a component or page — read through lib/data/public-designs.ts or lib/data/designer-designs.ts instead.',
            },
          ],
        },
      ],
    },
  },
];

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      // Branch snapshots written by scripts/codex-review-mr.sh. Gitignored, so
      // CI never sees them — but eslint did, and failed every LOCAL run with a
      // parsing error. A lint that always fails is a lint people stop running,
      // which is the same failure mode as a hook too slow to keep.
      '.codex-reviews/**',
      'dist/',
      'node_modules/',
      'public/sw.js',
      'scripts/',
      'mcp/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js', 'vite.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Test files — allow inline import() types for dynamic module references
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  // API edge functions — relaxed rules for server-side code
  {
    files: ['api/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // 2026-05-02 L4 secret-leak guard:
  // Block any reference to secret-shaped env vars from src/. They must
  // only be read from api/ (server-side). Forgetting this would let Vite
  // inline the secret into the client bundle.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/_KEY$|_TOKEN$|_SECRET$|_PASSWORD$/]",
          message:
            'Server-only secrets must not be read from src/. Read in api/* and forward via a typed response. (Vite inlines process.env into the client bundle.)',
        },
        {
          selector: "MemberExpression[object.name='env'][property.name=/_KEY$|_TOKEN$|_SECRET$|_PASSWORD$/]",
          message: 'Same as above — secret-shaped env access is forbidden in src/.',
        },
      ],
    },
  },
);

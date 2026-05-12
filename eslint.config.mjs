import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';

// Rules shared between production and test files
const sharedRules = {
  'no-console': 'warn',
  'no-unused-vars': 'off', // Disable base rule, use TypeScript version instead
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      varsIgnorePattern: '^_',
      argsIgnorePattern: '^_',
      ignoreRestSiblings: true,
      caughtErrorsIgnorePattern: '^_'
    }
  ],
  quotes: [
    'error',
    'single',
    {
      avoidEscape: true
    }
  ],
  '@typescript-eslint/no-unsafe-return': 'error'
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Base configuration for all files
  {
    files: ['**/*.{js,mjs,cjs,ts}']
  },

  // JavaScript configuration
  pluginJs.configs.recommended,

  // TypeScript configuration with type checking
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: ['./tsconfig.json', './__tests__/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  ...tseslint.configs.recommendedTypeChecked,

  // Strict rules for production code (src/**)
  {
    files: ['src/**/*.ts'],
    rules: {
      ...sharedRules,
      // Strict TypeScript rules for production
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn'
    }
  },

  // Configuration files can be slightly less strict
  {
    files: ['*.{js,mjs,cjs,ts}', '*.config.{js,mjs,cjs,ts}'],
    rules: {
      'no-console': 'off'
    }
  },

  // Test files configuration (more permissive)
  {
    files: ['__tests__/**/*.ts', '__tests__/**/*.tsx'],
    rules: {
      ...sharedRules,
      // P11TODO: Consider removing these rules and fixing the issues they are causing in test files
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off'
    }
  }
];

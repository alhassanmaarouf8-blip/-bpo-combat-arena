/**
 * Root ESLint flat config (ESLint 9+).
 * Applies to both server/ and client/.
 * Designed to enforce "Ponytail Mode" — small functions, low complexity, no dead code.
 */

const js = {
  files: ['**/*.{js,jsx}'],
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
    globals: {
      // Browser / Vite
      window: 'readonly',
      document: 'readonly',
      console: 'readonly',
      setTimeout: 'readonly',
      clearTimeout: 'readonly',
      setInterval: 'readonly',
      clearInterval: 'readonly',
      fetch: 'readonly',
      URL: 'readonly',
      URLSearchParams: 'readonly',
      WebSocket: 'readonly',
      // Node 20+ (avoids no-undef on AbortController, FormData, Blob, crypto)
      AbortController: 'readonly',
      FormData: 'readonly',
      Blob: 'readonly',
      crypto: 'readonly',
      crypto: 'readonly',
      Buffer: 'readonly',
      // Node (server)
      __dirname: 'readonly',
      __filename: 'readonly',
      process: 'readonly',
      require: 'readonly',
      module: 'readonly',
      exports: 'readonly',
    },
  },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-console': 'off', // server uses console.log intentionally
    'complexity': ['warn', { max: 8 }],
    'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
    'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
  },
};

export default [
  js,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'client/dist/**',
      '.husky/**',
    ],
  },
];

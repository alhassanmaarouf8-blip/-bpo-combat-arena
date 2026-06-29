// Guardian lint config — the ONE job here is to catch the runtime-crash class that `node --check`
// can't: undefined variables (`candidateName is not defined`, `USE_GEMINI_LIVE not defined`) that
// take fight-start down for real users. Deliberately narrow: no style rules, no opinionated noise —
// only errors that would actually break the app. Kept green on existing code so a red run always
// means a NEW real bug, never a false alarm.
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/build/**', 'graphify-out/**'] },

  // ── Server (Node, ESM) ──────────────────────────────────────────────────────
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',   // not a crash; off to avoid noise on a fast-moving codebase
      // NOTE: tried `no-use-before-define` to catch the temporal-dead-zone crash class, but it
      // flags 137 SAFE sites (module-level consts defined at file-bottom, referenced inside
      // functions above — initialized by run time, not a TDZ). Too noisy to be trustworthy, so
      // it's off; same-scope TDZ remains an accepted gap (the no-undef gate stays the workhorse).
    },
  },

  // ── Build/config files (Node, even though they sit under client/) ────────────
  {
    files: ['**/*.config.{js,mjs,cjs}', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'off' },
  },

  // ── Client (browser, React JSX) ─────────────────────────────────────────────
  {
    files: ['client/**/*.{js,jsx}'],
    ignores: ['client/**/*.config.{js,mjs,cjs}'],
    plugins: { 'react-hooks': reactHooks },   // registers the rule so inline disable directives resolve
    linterOptions: { reportUnusedDisableDirectives: 'off' },   // the inline hooks-disables are now redundant but harmless
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        // Compile-time constants injected by vite `define` (see client/vite.config.js) — real at
        // runtime, so not "undefined" bugs.
        __API_URL__: 'readonly',
        __WS_URL__: 'readonly',
        __BUILD_ID__: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
      // We don't ENFORCE hooks rules (the codebase intentionally disables them inline); registering
      // the plugin above just makes those inline directives valid instead of "rule not found" errors.
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];

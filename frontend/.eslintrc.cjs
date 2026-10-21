/**
 * Lint config.
 *
 * Added after a `toast is not defined` shipped to the login screen and broke
 * Google sign-in entirely: the variable was used, never imported, and nothing
 * in the pipeline looked. `no-undef` catches exactly that class of mistake,
 * which is the reason this file exists.
 *
 * Deliberately narrow. The rules below are the ones that catch real bugs; this
 * is not a style config, and the codebase is not being reformatted to suit it.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  plugins: ['react', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  rules: {
    // The whole point of the file.
    'no-undef': 'error',
    // Unused imports and variables are how dead code accumulates after a
    // refactor; several screens were carrying leftovers from old flows.
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    // The new JSX transform means React need not be in scope.
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    // Stale closures over props/state are the subtlest bug class in this app —
    // one of them is why a modal opened with the wrong amount prefilled.
    'react-hooks/exhaustive-deps': 'warn',
  },
  ignorePatterns: ['dist/', 'node_modules/', 'e2e/', 'public/'],
}

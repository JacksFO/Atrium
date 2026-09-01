import hooks from 'eslint-plugin-react-hooks'
import parser from '@typescript-eslint/parser'

/**
 * One rule, and it earns its place.
 *
 * `rules-of-hooks` is the only thing that catches a hook behind a condition or
 * an early return, and that mistake does not typecheck as wrong, does not fail
 * a render, and does not fail a test that renders once — it throws on the
 * SECOND render with a minified number for a message, which is how the whole
 * app went blank on changing server with the suite green.
 *
 * `exhaustive-deps` is a warning rather than an error: it is right often
 * enough to read and wrong often enough that failing on it would mean writing
 * code around the linter.
 */
export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]

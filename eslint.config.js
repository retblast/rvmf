import js from '@eslint/js'
import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'

export default [
  js.configs.recommended,
  {
    // ESLint 9's default file set is *.js only — without this, every
    // component file silently escapes linting.
    files: ['src/**/*.{js,jsx}'],
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.js'],
    plugins: {
      react: reactPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-undef': 'error',
      // Core no-undef does not inspect JSX element names — this is the
      // rule that catches undefined components like the ProxiedImg miss.
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'warn',
      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        // allow the `const { key, ...rest } = obj` omit idiom
        ignoreRestSiblings: true,
      }],
    },
  },
]

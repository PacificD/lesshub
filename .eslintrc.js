module.exports = {
  parser: '@typescript-eslint/parser',
  extends: ['eslint:recommended', 'prettier'],
  plugins: ['@typescript-eslint', 'prettier'],
  ignorePatterns: ['*.cjs'],
  overrides: [],
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2020
  },
  env: {
    browser: true,
    es2017: true,
    node: true
  },
  rules: {
    'prettier/prettier': 0,
    semi: [2, 'never'],
    'no-unused-vars': 1,
    quotes: 0,
    'comma-dangle': [2, 'never'],
    'no-unused-expressions': [
      0,
      {
        allowShortCircuit: true,
        allowTernary: true
      }
    ]
  }
}

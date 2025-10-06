module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  env: { node: true, es2022: true, jest: false },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', project: false },
  rules: {
    'no-console': ['error', { allow: ['warn', 'error'] }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'import/order': [
      'warn',
      {
        groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']],
        'newlines-between': 'always',
      },
    ],
  },
  settings: {
    'import/resolver': {
      typescript: true,
    },
  },
};



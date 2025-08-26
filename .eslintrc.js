module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es2021: true,
    node: true,
    jest: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // CRITICAL: This rule catches undeclared variables
    'no-undef': 'error',
    
    // Additional helpful rules for catching common issues
    'no-unused-vars': 'warn',
    'no-redeclare': 'error',
    'no-implicit-globals': 'error',
    
    // Best practices
    'prefer-const': 'warn',
    'no-var': 'warn',
    'eqeqeq': 'warn',
    'curly': 'warn'
  },
  globals: {
    // Add any global variables your project uses
    // For example, if you use global constants or browser globals
    'process': 'readonly',
    'Buffer': 'readonly',
    'console': 'readonly',
    '__dirname': 'readonly',
    '__filename': 'readonly',
    'global': 'readonly'
  }
};

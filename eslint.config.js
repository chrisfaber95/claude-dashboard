import tseslint from 'typescript-eslint';

// Readability rules of docs/code-style.md. Formatting is not checked here.

// Files that still break the readability rules. This list may only shrink: cleanup tickets remove entries as
// they fix a file, and a new or moved file must pass the rules (a move only updates the path).
export const LEGACY_FILES = [];

const FORBIDDEN_ABBREVIATIONS = [
  'fmt', 'st', 'rec', 'sid', 'msg', 'buf', 'el', 'cls', 'tmp', 'cfg',
];

const readabilityRules = {
  'id-length': ['error', { min: 2, exceptions: ['i', 'j', 'a', 'b', '_'], properties: 'never' }],
  'id-denylist': ['error', ...FORBIDDEN_ABBREVIATIONS],
  '@typescript-eslint/naming-convention': [
    'error',
    { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
    { selector: 'variable', format: ['camelCase', 'UPPER_CASE'], leadingUnderscore: 'allow' },
    {
      selector: 'variable',
      types: ['boolean'],
      format: ['PascalCase'],
      prefix: ['is', 'has', 'should', 'can'],
    },
    { selector: 'typeLike', format: ['PascalCase'] },
    { selector: 'import', format: null },
    { selector: 'property', format: null },
    { selector: 'objectLiteralMethod', format: null },
    { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
  ],
  'no-nested-ternary': 'error',
  'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
  'max-depth': ['error', 4],
};

export default tseslint.config(
  { ignores: ['public/**', 'node_modules/**', '.dashboard/**', 'tests/lint-fixtures/**', 'eslint.config.js'] },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: readabilityRules,
  },
  {
    files: ['tests/**/*.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
  ...(LEGACY_FILES.length === 0
    ? []
    : [{
        files: LEGACY_FILES,
        rules: Object.fromEntries(Object.keys(readabilityRules).map((rule) => [rule, 'off'])),
      }]),
);

import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

// Readability rules of docs/code-style.md. Formatting is not checked here.

// Files that still break the readability rules. This list may only shrink: cleanup tickets remove entries as
// they fix a file, and a new or moved file must pass the rules (a move only updates the path).
export const LEGACY_FILES = [];

// Files that still use `any`, type assertions, non-null `!` or untyped exported functions (decision 0007 "Typing").
// Same rule as LEGACY_FILES: this list may only shrink; cleanup tickets remove entries as they fix a file.
export const TYPE_SAFETY_LEGACY_FILES = [
  'src/client/app/patch.ts',
  'src/client/app/state-stream.ts',
  'src/client/features/alerts/alerts.logic.ts',
  'src/client/features/alerts/alerts.view.ts',
  'src/client/features/building/building.logic.ts',
  'src/client/features/chat/chat.logic.ts',
  'src/client/features/controls/controls.logic.ts',
  'src/client/features/controls/controls.view.ts',
  'src/client/features/controls/drawer.view.ts',
  'src/client/features/messages/messages.view.ts',
  'src/client/features/permissions/permissions.logic.ts',
  'src/client/features/permissions/permissions.view.ts',
  'src/client/features/usage/usage.view.ts',
  'src/client/shared/api.ts',
  'src/client/shared/dom.ts',
  'src/client/shared/escape.ts',
  'src/client/shared/token-format.ts',
  'src/server/claude/claude-cli.ts',
  'src/server/claude/session-summary.ts',
  'src/server/config.ts',
  'src/server/features/permissions/permissions.ts',
  'src/server/features/team/team.ts',
  'src/server/transcripts/state.ts',
  'tests/client/app/patch.test.ts',
  'tests/client/features/chat/chat.logic.test.ts',
  'tests/client/features/core/mood.logic.test.ts',
  'tests/client/features/permissions/permissions.logic.test.ts',
  'tests/client/skins/root-assets.test.ts',
  'tests/copy-assets.test.ts',
  'tests/helpers.ts',
  'tests/server/auth/auth-pairing-sessions.test.ts',
  'tests/server/auth/auth-test-setup.ts',
  'tests/server/auth/auth.test.ts',
  'tests/server/auth/devices.test.ts',
  'tests/server/claude/session-summary.test.ts',
  'tests/server/claude/summary-model.test.ts',
  'tests/server/commands-follow-up.test.ts',
  'tests/server/commands-permissions.test.ts',
  'tests/server/commands-test-setup.ts',
  'tests/server/commands.test.ts',
  'tests/server/f002-flow.test.ts',
  'tests/server/features/alerts/alerts.test.ts',
  'tests/server/features/audit-log/audit-log.test.ts',
  'tests/server/features/limits/limits.test.ts',
  'tests/server/features/permissions/permissions.test.ts',
  'tests/server/features/team/team.test.ts',
  'tests/server/lan-audit-streams.test.ts',
  'tests/server/lan-devices.test.ts',
  'tests/server/lan-pairing.test.ts',
  'tests/server/lan-test-setup.ts',
  'tests/server/server.test.ts',
  'tests/server/static-fonts.test.ts',
  'tests/server/transcripts/subagents-feed-and-endpoints.test.ts',
  'tests/server/transcripts/subagents-test-setup.ts',
  'tests/server/transcripts/subagents.test.ts',
  'tests/server/transcripts/transcript-view.test.ts',
  'tests/server/transcripts/transcripts.test.ts',
];

const typeSafetyRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
  '@typescript-eslint/explicit-module-boundary-types': 'error',
};

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
    rules: { ...readabilityRules, ...typeSafetyRules },
  },
  // Vue single-file components: the essential Vue rules (formatting is not checked) plus the same readability rules (decision 0007).
  ...pluginVue.configs['flat/essential'],
  {
    files: ['src/**/*.vue', 'tests/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...readabilityRules, ...typeSafetyRules, 'vue/no-v-html': 'error' },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.vue'],
    rules: { 'max-lines-per-function': 'off' },
  },
  ...(LEGACY_FILES.length === 0
    ? []
    : [{
        files: LEGACY_FILES,
        rules: Object.fromEntries(Object.keys(readabilityRules).map((rule) => [rule, 'off'])),
      }]),
  ...(TYPE_SAFETY_LEGACY_FILES.length === 0
    ? []
    : [{
        files: TYPE_SAFETY_LEGACY_FILES,
        rules: Object.fromEntries(Object.keys(typeSafetyRules).map((rule) => [rule, 'off'])),
      }]),
);

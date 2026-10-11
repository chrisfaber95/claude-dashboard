import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ESLint } from 'eslint';
import { LEGACY_FILES, TYPE_SAFETY_LEGACY_FILES } from '../eslint.config.js';

test('a new file with forbidden names and nested ternaries fails lint', async () => {
  const eslint = new ESLint({ ignore: false });
  const [result] = await eslint.lintFiles(['tests/lint-fixtures/bad-names.ts']);
  const ruleIds = result.messages.map((message) => message.ruleId);
  assert.ok(ruleIds.includes('id-denylist'));
  assert.ok(ruleIds.includes('no-nested-ternary'));
});

test('every LEGACY_FILES entry still exists, so the list can only shrink', () => {
  const missing = LEGACY_FILES.filter((file) => !existsSync(file));
  assert.deepEqual(missing, []);
});

test('a .vue file with a forbidden name and v-html fails lint', async () => {
  const eslint = new ESLint({ ignore: false });
  const [result] = await eslint.lintFiles(['tests/lint-fixtures/bad-names.vue']);
  const ruleIds = result.messages.map((message) => message.ruleId);
  assert.ok(ruleIds.includes('id-denylist'));
  assert.ok(ruleIds.includes('vue/no-v-html'));
});

test('a new file with as, any, non-null ! and an untyped export fails lint, while as const passes', async () => {
  const eslint = new ESLint({ ignore: false });
  const [result] = await eslint.lintFiles(['tests/lint-fixtures/bad-types.ts']);
  const ruleIds = result.messages.map((message) => message.ruleId);
  assert.ok(ruleIds.includes('@typescript-eslint/consistent-type-assertions'));
  assert.ok(ruleIds.includes('@typescript-eslint/no-explicit-any'));
  assert.ok(ruleIds.includes('@typescript-eslint/no-non-null-assertion'));
  assert.ok(ruleIds.includes('@typescript-eslint/explicit-module-boundary-types'));
  const assertionLines = result.messages
    .filter((message) => message.ruleId === '@typescript-eslint/consistent-type-assertions')
    .map((message) => message.line);
  assert.deepEqual(assertionLines, [3]);
});

test('every TYPE_SAFETY_LEGACY_FILES entry still exists, so the list can only shrink', () => {
  const missing = TYPE_SAFETY_LEGACY_FILES.filter((file) => !existsSync(file));
  assert.deepEqual(missing, []);
});

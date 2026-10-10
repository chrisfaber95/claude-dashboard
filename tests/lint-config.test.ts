import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ESLint } from 'eslint';
import { LEGACY_FILES } from '../eslint.config.js';

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

// Search panel helpers: link safety, request building and response guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_QUESTION_LENGTH, buildRequest, cleanQuestion, combinedError, describeLocation, isSearchAnswer, isSearchQueryResponse, safeHref } from '../../../../src/client/features/search/search.logic.ts';

test('safeHref accepts only http and https', () => {
  assert.equal(safeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeHref('http://example.com/'), 'http://example.com/');
});

test('safeHref rejects javascript:, data:, relative, malformed and non-string input', () => {
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', '/api/x', 'example.com', 'http://', '', '   ']) {
    assert.equal(safeHref(bad), null, bad);
  }
  assert.equal(safeHref(undefined), null);
  assert.equal(safeHref(42), null);
});

test('cleanQuestion trims, caps the length and rejects blanks', () => {
  assert.equal(cleanQuestion('  hi  '), 'hi');
  assert.equal(cleanQuestion('   '), null);
  assert.equal(cleanQuestion('a'.repeat(MAX_QUESTION_LENGTH + 5))?.length, MAX_QUESTION_LENGTH);
});

test('buildRequest leaves out empty filters and sends hard only when true', () => {
  assert.deepEqual(buildRequest('q', '', ''), { question: 'q' });
  assert.deepEqual(buildRequest('q', 'demo', 'wiki', true), { question: 'q', project: 'demo', sourceType: 'wiki', hard: true });
  assert.deepEqual(buildRequest('q', '', '', false), { question: 'q' });
});

test('response guards check the shape', () => {
  const citation = { source: 's', location: 'l', url: '' };
  assert.equal(isSearchAnswer({ answer: 'a', citations: [citation], requestId: '', backend: 'local' }), true);
  assert.equal(isSearchAnswer({ answer: 'a', citations: [{ source: 1 }], requestId: '', backend: 'local' }), false);
  assert.equal(isSearchAnswer(null), false);
  const result = { source: 's', location: 'l', date: '', project: 'p', sourceType: 'wiki', snippet: 'x', url: '' };
  assert.equal(isSearchQueryResponse({ results: [result] }), true);
  assert.equal(isSearchQueryResponse({ results: [{ ...result, snippet: 1 }] }), false);
  assert.equal(isSearchQueryResponse({}), false);
});

test('describeLocation and combinedError', () => {
  assert.equal(describeLocation('wiki', 'Intro'), 'wiki / Intro');
  assert.equal(describeLocation('wiki', ''), 'wiki');
  assert.equal(combinedError('search service unreachable', 'x'), 'search service unreachable');
  assert.equal(combinedError('', ''), 'Search service unreachable');
});

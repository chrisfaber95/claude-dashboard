// Search client: request validation, the three upstream calls, normalised answers and fixed error texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandError } from '../../../../src/server/claude/claude-cli.ts';
import { createSearchClient, parseFeedbackRequestId, parseSearchRequest } from '../../../../src/server/features/search/search.ts';

const BASE = 'http://search.tailnet.invalid:8120';

interface Call {
  url: string;
  init: RequestInit;
}

/** A fake fetch that records calls and answers with the given JSON (or throws / returns a status). */
function fakeFetch(reply: unknown, status = 200): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (reply instanceof Error) throw reply;
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status });
  };
  return { fetch: fetchImpl, calls };
}

function rejectsWith(status: number, message?: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof CommandError, 'expected a CommandError');
    assert.equal(error.status, status);
    if (message) assert.match(error.message, message);
    return true;
  };
}

test('parseSearchRequest trims the question and accepts simple filters', () => {
  assert.deepEqual(parseSearchRequest({ question: '  where did we decide X?  ', project: 'claude-dashboard', sourceType: 'wiki', hard: true }), {
    question: 'where did we decide X?',
    project: 'claude-dashboard',
    sourceType: 'wiki',
    hard: true,
  });
  assert.equal(parseSearchRequest({ question: 'q', project: '' }).project, undefined);
  assert.equal(parseSearchRequest({ question: 'q', hard: 'yes' }).hard, false);
});

test('parseSearchRequest rejects bad questions and filters with a 400', () => {
  for (const body of [null, [], {}, { question: 5 }, { question: '   ' }, { question: 'x'.repeat(1001) }]) {
    assert.throws(() => parseSearchRequest(body), rejectsWith(400));
  }
  assert.throws(() => parseSearchRequest({ question: 'q', project: '../etc' }), rejectsWith(400, /project/));
  assert.throws(() => parseSearchRequest({ question: 'q', sourceType: { $ne: 1 } }), rejectsWith(400, /source type/));
});

test('parseFeedbackRequestId accepts router ids only', () => {
  assert.equal(parseFeedbackRequestId({ requestId: 'req_2026-11-04:abc.1' }), 'req_2026-11-04:abc.1');
  for (const body of [{}, { requestId: '' }, { requestId: 'a b' }, { requestId: '../x' }, { requestId: 'x'.repeat(101) }, { requestId: 7 }]) {
    assert.throws(() => parseFeedbackRequestId(body), rejectsWith(400));
  }
});

test('query posts to /query with the filters and the token, and normalises the results', async () => {
  const { fetch, calls } = fakeFetch({
    results: [
      { source: 'wiki/home.md', location: '## Decisions', date: '2026-10-30', project: 'homelab', source_type: 'wiki', snippet: 'We chose X', url: 'https://home.example/page' },
      { source: 'x', url: 'javascript:alert(1)' },
      { source: 'same', url: `${BASE}/doc/1` },
      { nothing: true },
      'junk',
    ],
  });
  const client = createSearchClient({ baseUrl: `${BASE}/`, token: 'secret-token', fetch });
  const response = await client.query({ question: 'X', project: 'homelab', sourceType: 'wiki' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/query`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { query: 'X', limit: 20, project: 'homelab', source_type: 'wiki' });
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer secret-token');
  assert.equal(response.results.length, 3);
  assert.deepEqual(response.results[0], {
    source: 'wiki/home.md',
    location: '## Decisions',
    date: '2026-10-30',
    project: 'homelab',
    sourceType: 'wiki',
    snippet: 'We chose X',
    url: 'https://home.example/page',
  });
  assert.equal(response.results[1].url, '', 'javascript: link dropped');
  assert.equal(response.results[2].url, '', "a link on the search service's own origin is dropped");
});

test('ask sends the hard flag and returns answer, citations and request id', async () => {
  const { fetch, calls } = fakeFetch({
    answer: 'We decided X <b>bold</b>.',
    citations: [{ source: 'wiki/x.md', location: 'Decision', url: 'https://home.example/x' }, { location: 'no source' }],
    request_id: 'req-123',
    backend: 'claude',
  });
  const client = createSearchClient({ baseUrl: BASE, fetch });
  const answer = await client.ask({ question: 'why X?', hard: true });

  assert.equal(calls[0].url, `${BASE}/ask`);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { question: 'why X?', hard: true });
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), null);
  assert.deepEqual(answer, {
    answer: 'We decided X <b>bold</b>.',
    citations: [{ source: 'wiki/x.md', location: 'Decision', url: 'https://home.example/x' }],
    requestId: 'req-123',
    backend: 'claude',
  });
});

test('ask drops a request id that is not a plain id', async () => {
  const { fetch } = fakeFetch({ answer: 'a', citations: [], request_id: '../../admin' });
  assert.equal((await createSearchClient({ baseUrl: BASE, fetch }).ask({ question: 'q' })).requestId, '');
});

test('feedback posts the request id with a down rating to /feedback', async () => {
  const { fetch, calls } = fakeFetch({ ok: true });
  await createSearchClient({ baseUrl: BASE, fetch }).feedback({ requestId: 'req-123' });
  assert.equal(calls[0].url, `${BASE}/feedback`);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { request_id: 'req-123', rating: 'down' });
});

test('an unreachable service gives a fixed 502 that does not leak the address', async () => {
  const { fetch } = fakeFetch(new TypeError(`connect ECONNREFUSED ${BASE}`));
  const client = createSearchClient({ baseUrl: BASE, token: 'secret-token', fetch });
  for (const call of [() => client.query({ question: 'q' }), () => client.ask({ question: 'q' }), () => client.feedback({ requestId: 'r' })]) {
    await assert.rejects(call, (error) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.status, 502);
      assert.equal(error.message, 'The search service is unreachable.');
      assert.ok(!error.message.includes('tailnet') && !error.message.includes('secret-token'));
      return true;
    });
  }
});

test('an error status or an unreadable body gives a fixed 502', async () => {
  await assert.rejects(createSearchClient({ baseUrl: BASE, fetch: fakeFetch({ detail: 'boom' }, 500).fetch }).ask({ question: 'q' }), rejectsWith(502, /returned an error/));
  await assert.rejects(createSearchClient({ baseUrl: BASE, fetch: fakeFetch('<html>not json').fetch }).query({ question: 'q' }), rejectsWith(502, /unreadable/));
  await assert.rejects(createSearchClient({ baseUrl: BASE, fetch: fakeFetch([1, 2]).fetch }).ask({ question: 'q' }), rejectsWith(502, /unreadable/));
});

test('invalid input never reaches the service', async () => {
  const { fetch, calls } = fakeFetch({});
  const client = createSearchClient({ baseUrl: BASE, fetch });
  await assert.rejects(client.query({ question: '' }), rejectsWith(400));
  await assert.rejects(client.feedback({ requestId: 'bad id' }), rejectsWith(400));
  assert.equal(calls.length, 0);
});

test('a missing results list gives an empty result list', async () => {
  const { fetch } = fakeFetch({});
  assert.deepEqual(await createSearchClient({ baseUrl: BASE, fetch }).query({ question: 'q' }), { results: [] });
});

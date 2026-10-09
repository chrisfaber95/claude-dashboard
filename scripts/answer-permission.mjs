// Local helper to answer a held permission prompt (the dashboard UI for this comes later).
//   node scripts/answer-permission.mjs                    list pending requests
//   node scripts/answer-permission.mjs <id> allow|deny    answer one
// Env: DASHBOARD_URL (default http://127.0.0.1:4777), DASHBOARD_DATA_DIR (default <repo>/.dashboard, holds hook-secret).
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = new URL(process.env.DASHBOARD_URL ?? 'http://127.0.0.1:4777');
const dataDir = process.env.DASHBOARD_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.dashboard');
const secret = readFileSync(join(dataDir, 'hook-secret'), 'utf8').trim();
const [id, decision] = process.argv.slice(2);

function call(method, path, body) {
  return new Promise((done, fail) => {
    const lib = base.protocol === 'https:' ? httpsRequest : httpRequest;
    const data = body ? JSON.stringify(body) : '';
    const req = lib(
      new URL(path, base),
      { method, rejectUnauthorized: false, headers: { Origin: base.origin, 'X-Dashboard': '1', 'X-Hook-Secret': secret, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => done({ status: res.statusCode, text }));
      },
    );
    req.on('error', fail);
    req.end(data);
  });
}

try {
  if (!id) {
    const r = await call('GET', '/hook/permission');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const list = JSON.parse(r.text).requests;
    if (!list.length) console.log('No pending permission requests.');
    for (const p of list) console.log(`${p.id}  ${p.tool}  session ${p.sessionId.slice(0, 8)}\n    ${p.text.replace(/\n/g, '\n    ')}`);
  } else {
    if (decision !== 'allow' && decision !== 'deny') throw new Error('usage: answer-permission.mjs <id> allow|deny');
    const r = await call('POST', '/hook/permission/answer', { id, decision });
    console.log(r.status === 200 ? `Answered: ${decision}` : `Not answered (HTTP ${r.status}): ${r.text}`);
    if (r.status !== 200) process.exitCode = 1;
  }
} catch (e) {
  console.error(`Failed: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
}

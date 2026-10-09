// Claude Code `PermissionRequest` hook for sessions the dashboard starts. Reads the hook JSON on stdin, sends the
// request to the dashboard (127.0.0.1 only) with the hook secret, waits for the answer and prints the decision.
// Any problem (dashboard down, wrong secret, no answer in time, odd input) prints nothing: the session then shows its
// normal prompt. No dependencies. Usage: node permission-hook.mjs --url http://127.0.0.1:4777 --secret-file <path>
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BODY_MAX = 60_000;
const DEFAULT_TIMEOUT_MS = 9.5 * 60_000;

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** The hook's stdout for an answer, or null (print nothing) for anything else. */
export function decisionOutput(decision) {
  if (decision !== 'allow' && decision !== 'deny') return null;
  const d = decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied from the dashboard.' };
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } });
}

function post(url, headers, body, timeoutMs) {
  return new Promise((done) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = lib(
      u,
      // The dashboard's LAN certificate is self-signed; the target is always this PC's loopback address.
      { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, rejectUnauthorized: false, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            done(res.statusCode === 200 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null);
          } catch {
            done(null);
          }
        });
        res.on('error', () => done(null));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => done(null));
    req.end(body);
  });
}

/** Runs the hook for one stdin payload. Resolves with the text to print, or null for "no decision". */
export async function runHook(stdin, argv) {
  try {
    const url = argValue(argv, '--url');
    const secretFile = argValue(argv, '--secret-file');
    if (!url || !secretFile) return null;
    const target = new URL(url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) return null;
    const input = JSON.parse(stdin);
    if (typeof input.session_id !== 'string' || typeof input.tool_name !== 'string') return null;
    const secret = readFileSync(secretFile, 'utf8').trim();
    let toolInput = input.tool_input ?? null;
    if (JSON.stringify(toolInput).length > BODY_MAX - 1000) toolInput = { truncated: JSON.stringify(toolInput).slice(0, BODY_MAX - 2000) };
    const body = JSON.stringify({ sessionId: input.session_id, tool: input.tool_name, toolInput });
    const res = await post(
      `${target.origin}/hook/permission`,
      { 'Content-Type': 'application/json', Origin: target.origin, 'X-Dashboard': '1', 'X-Hook-Secret': secret },
      body,
      Number(argValue(argv, '--timeout-ms')) || DEFAULT_TIMEOUT_MS,
    );
    return decisionOutput(res?.decision);
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stdin = '';
  for await (const chunk of process.stdin) stdin += chunk;
  const out = await runHook(stdin, process.argv.slice(2));
  if (out) process.stdout.write(out);
  process.exit(0);
}

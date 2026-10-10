// Stand-in for claude.exe in tests: records argv + cwd, answers like the real CLI.
import { appendFileSync, rmSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\n');

if (process.cwd().includes('Untrusted')) {
  console.log(`Workspace not trusted. Run \`claude\` in ${process.cwd()} once and accept the trust prompt, then retry.`);
  process.exit(1);
}
if (args[0] === '-p') {
  // One-shot summary call: the transcript arrives on stdin. FAKE_CLAUDE_SUMMARY_FAILS / _DELAY_MS simulate errors and slowness.
  let stdin = '';
  for await (const chunk of process.stdin) stdin += chunk;
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ stdin }) + '\n');
  const summaryDelayMs = Number(process.env.FAKE_CLAUDE_SUMMARY_DELAY_MS) || 0;
  if (summaryDelayMs) await new Promise((resolve) => setTimeout(resolve, summaryDelayMs));
  if (process.env.FAKE_CLAUDE_SUMMARY_FAILS) {
    console.log('boom');
    process.exit(1);
  }
  console.log('Model summary: <b>fixed</b>');
} else if (args[0] === 'logs') {
  console.log('line one\nline two');
} else if (args[0] === 'stop') {
  // Simulates the stopped session's process exiting: its sessions/<pid>.json disappears.
  if (process.env.FAKE_CLAUDE_STOP_REMOVES) rmSync(process.env.FAKE_CLAUDE_STOP_REMOVES, { force: true });
  // FAKE_CLAUDE_STOP_FAILS makes the stop exit non-zero (the session file is still removed if asked above).
  if (process.env.FAKE_CLAUDE_STOP_FAILS) {
    console.log('Could not stop session.');
    process.exit(1);
  }
  console.log('Stopped session.');
} else {
  // FAKE_CLAUDE_RESUME_DELAY_MS keeps a start/resume call in flight, to test concurrent requests.
  const resumeDelayMs = Number(process.env.FAKE_CLAUDE_RESUME_DELAY_MS) || 0;
  if (resumeDelayMs) await new Promise((resolve) => setTimeout(resolve, resumeDelayMs));
  console.log('Started background session\nbg-1a2b3c');
}

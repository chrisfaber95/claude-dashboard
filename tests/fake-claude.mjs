// Stand-in for claude.exe in tests: records argv + cwd, answers like the real CLI.
import { appendFileSync, rmSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\n');

if (process.cwd().includes('Untrusted')) {
  console.log(`Workspace not trusted. Run \`claude\` in ${process.cwd()} once and accept the trust prompt, then retry.`);
  process.exit(1);
}
if (args[0] === 'logs') console.log('line one\nline two');
else if (args[0] === 'stop') {
  // Simulates the stopped session's process exiting: its sessions/<pid>.json disappears.
  if (process.env.FAKE_CLAUDE_STOP_REMOVES) rmSync(process.env.FAKE_CLAUDE_STOP_REMOVES, { force: true });
  // FAKE_CLAUDE_STOP_FAILS makes the stop exit non-zero (the session file is still removed if asked above).
  if (process.env.FAKE_CLAUDE_STOP_FAILS) {
    console.log('Could not stop session.');
    process.exit(1);
  }
  console.log('Stopped session.');
}
else {
  // FAKE_CLAUDE_RESUME_DELAY_MS keeps a start/resume call in flight, to test concurrent requests.
  const delay = Number(process.env.FAKE_CLAUDE_RESUME_DELAY_MS) || 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  console.log('Started background session\nbg-1a2b3c');
}

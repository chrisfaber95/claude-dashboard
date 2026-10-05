// Stand-in for claude.exe in tests: records argv + cwd, answers like the real CLI.
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\n');

if (process.cwd().includes('Untrusted')) {
  console.log(`Workspace not trusted. Run \`claude\` in ${process.cwd()} once and accept the trust prompt, then retry.`);
  process.exit(1);
}
if (args[0] === 'logs') console.log('line one\nline two');
else if (args[0] === 'stop') console.log('Stopped session.');
else console.log('Started background session\nbg-1a2b3c');

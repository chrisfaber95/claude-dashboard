import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });
for (const f of ['index.html', 'login.html']) copyFileSync(`src/client/${f}`, `public/${f}`);

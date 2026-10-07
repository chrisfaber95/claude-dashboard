import { copyFileSync, mkdirSync } from 'node:fs';
import { copyFonts } from './copy-fonts.mjs';

mkdirSync('public', { recursive: true });
for (const f of ['index.html', 'login.html']) copyFileSync(`src/client/${f}`, `public/${f}`);
copyFonts();

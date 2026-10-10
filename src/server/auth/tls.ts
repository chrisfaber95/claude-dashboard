import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

const OPENSSL = process.env.OPENSSL ?? (existsSync('C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe')
  ? 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'
  : 'openssl');

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out.sort();
}

/**
 * Self-signed cert for LAN mode, stored in the data dir. Regenerated when the
 * hostname/IP set changes so the SANs stay valid.
 */
export function ensureCert(dataDir: string): { key: Buffer; cert: Buffer } {
  mkdirSync(dataDir, { recursive: true });
  const keyFile = join(dataDir, 'key.pem');
  const certFile = join(dataDir, 'cert.pem');
  const sanFile = join(dataDir, 'cert.sans');
  const host = hostname();
  const sans = [`DNS:${host}`, 'DNS:localhost', 'IP:127.0.0.1', ...lanAddresses().map((ip) => `IP:${ip}`)].join(',');

  const current = existsSync(sanFile) ? readFileSync(sanFile, 'utf8') : '';
  if (!existsSync(keyFile) || !existsSync(certFile) || current !== sans) {
    execFileSync(
      OPENSSL,
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
        '-keyout', keyFile, '-out', certFile,
        '-subj', `/CN=${host} Claude Dashboard`,
        '-addext', `subjectAltName=${sans}`,
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    writeFileSync(sanFile, sans);
  }
  return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
}

// tests/unit/guards/provider-calls.test.ts
//
// Llamadas a proveedores externos (docs/ARCHITECTURE.md, "Llamadas a proveedores externos"), por análisis
// estático: los reintentos, el timeout y el circuit breaker los pone callProvider, no el SDK de AWS.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === 'generated' ? [] : walk(full);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const sourceFiles = walk(path.join(ROOT, 'src'));

// Clientes cuyas llamadas pasan por callProvider. CloudFront no: no es un producto del dashboard y conserva
// los reintentos propios del SDK.
const CLIENTS_UNDER_CALL_PROVIDER = /new\s+(SESClient|SNSClient|S3Client)\(\s*\{([^}]*)/g;

describe('Guardas — llamadas a proveedores externos', () => {
  it('los clientes SES/SNS/S3 se crean con AWS_CLIENT_OPTIONS (sin reintentos propios del SDK)', () => {
    const offenders = sourceFiles.flatMap(f => {
      const src = fs.readFileSync(f, 'utf8');
      return [...src.matchAll(CLIENTS_UNDER_CALL_PROVIDER)]
        .filter(([, , options]) => !options!.includes('...AWS_CLIENT_OPTIONS'))
        .map(([, client]) => `${rel(f)} (${client})`);
    });
    expect(offenders).toEqual([]);
  });

  it('hay al menos un cliente revisado (la guarda no quedó vacía por un cambio de forma)', () => {
    const found = sourceFiles.filter(f => /new\s+(SESClient|SNSClient|S3Client)\(/.test(fs.readFileSync(f, 'utf8')));
    expect(found.length).toBeGreaterThanOrEqual(4);
  });
});

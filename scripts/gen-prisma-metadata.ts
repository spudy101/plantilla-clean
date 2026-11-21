// scripts/gen-prisma-metadata.ts — corre después de `prisma generate` (npm run prisma:generate).
//
// Escribe src/shared/database/generated/prisma-metadata.ts: por cada modelo del schema, sus campos escalares
// y sus relaciones (campo → modelo destino). Lo usan las extensiones de Prisma (src/shared/database/
// prisma-extensions.ts) para recorrer escrituras anidadas y resultados con `include` sabiendo qué
// modelo es cada objeto: el cliente generado de Prisma 7 no expone su datamodel en runtime.
//
// Lee prisma/schema.prisma (ya normalizado por `prisma format`): un campo por línea, `nombre Tipo …`.
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = path.resolve('prisma/schema.prisma');
const OUT = path.resolve('src/shared/database/generated/prisma-metadata.ts');

const src = fs.readFileSync(SCHEMA, 'utf8').replace(/\r\n/g, '\n');
const blocks = [...src.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)].map(m => ({ name: m[1]!, body: m[2]! }));
const modelNames = new Set(blocks.map(b => b.name));

const models: Record<string, { scalars: string[]; relations: Record<string, string> }> = {};
for (const { name, body } of blocks) {
  const scalars: string[] = [];
  const relations: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^\s+(\w+)\s+([\w]+)(\[\])?\??(\s|$)/);
    if (!m || line.trim().startsWith('@@') || line.trim().startsWith('//')) continue;
    const [, field, type] = m;
    if (modelNames.has(type!)) relations[field!] = type!;
    else scalars.push(field!);
  }
  models[name] = { scalars, relations };
}

const out = `/* !!! Generado por scripts/gen-prisma-metadata.ts desde prisma/schema.prisma. No editar. !!! */
/* eslint-disable */
// Campos escalares y relaciones (campo → modelo destino) de cada modelo de Prisma.
export interface ModelMetadata {
  scalars: readonly string[];
  relations: Readonly<Record<string, string>>;
}

export const PRISMA_MODELS: Readonly<Record<string, ModelMetadata>> = ${JSON.stringify(models, null, 2)};
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`${path.relative(process.cwd(), OUT)}: ${Object.keys(models).length} modelos`);

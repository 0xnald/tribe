import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_CATEGORIES, VECTOR_SCHEMA, VECTOR_VERSION, type Category } from './build';
import { stringify } from './codec';

/**
 * Writes packages/core/test-vectors/<category>.json from the reference
 * implementation. Run with `pnpm --filter @tribe/core vectors`.
 */

export interface VectorFile {
  schema: string;
  version: number;
  category: string;
  engine: string;
  notes: string;
  vectors: { name: string; description: string; inputs: unknown; expected: unknown }[];
}

export function buildFile(cat: Category<unknown>): VectorFile {
  return {
    schema: VECTOR_SCHEMA,
    version: VECTOR_VERSION,
    category: cat.category,
    engine: '@tribe/core reference implementation',
    notes:
      'All integers are decimal strings (bigint). Rust: parse with u128/i128::from_str. ' +
      'Error outcomes are ErrorCode identifiers (see src/engine/errors.ts).',
    vectors: cat.cases.map((c) => ({
      name: c.name,
      description: c.description,
      inputs: c.inputs,
      expected: cat.run(c.inputs),
    })),
  };
}

export function outputDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-vectors');
}

export function writeAll(dir = outputDir()): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const cat of ALL_CATEGORIES) {
    const file = join(dir, `${cat.category}.json`);
    writeFileSync(file, stringify(buildFile(cat)));
    written.push(file);
  }
  return written;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const f of writeAll()) process.stdout.write(`wrote ${f}\n`);
}

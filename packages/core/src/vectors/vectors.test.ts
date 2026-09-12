import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_CATEGORIES, VECTOR_SCHEMA, VECTOR_VERSION } from './build';
import { arr, encode, num, obj, str, type Json } from './codec';
import { outputDir } from './generate';

/**
 * Round-trip verification of the committed JSON vectors: decode `inputs`
 * from JSON, recompute with the engine, and compare with the committed
 * `expected`. If the engine changes, this fails until the vectors are
 * regenerated deliberately (`pnpm --filter @tribe/core vectors`).
 */

const dir = outputDir();
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('committed test vectors', () => {
  it('one file per category, schema and version match', () => {
    expect(files.sort()).toEqual(ALL_CATEGORIES.map((c) => `${c.category}.json`).sort());
  });

  let total = 0;
  for (const cat of ALL_CATEGORIES) {
    const raw = obj(JSON.parse(readFileSync(join(dir, `${cat.category}.json`), 'utf8')) as Json);
    const vectors = arr(raw.vectors);
    total += vectors.length;
    describe(cat.category, () => {
      it('header', () => {
        expect(str(raw.schema)).toBe(VECTOR_SCHEMA);
        expect(num(raw.version)).toBe(VECTOR_VERSION);
        expect(str(raw.category)).toBe(cat.category);
        expect(vectors.length).toBe(cat.cases.length);
      });
      for (const v of vectors) {
        const vo = obj(v);
        it(str(vo.name), () => {
          const inputs = cat.decode(vo.inputs ?? null);
          const recomputed = encode(cat.run(inputs));
          expect(recomputed).toEqual(vo.expected);
        });
      }
    });
  }

  it('reports the vector count', () => {
    expect(total).toBeGreaterThan(80);
  });
});

/**
 * JSON codec for test vectors. Every bigint is serialised as a decimal string
 * so the files are language-neutral (Rust: `u128::from_str`).
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function encode(value: unknown): Json {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(encode);
  if (value instanceof Map) return encode(Object.fromEntries(value));
  if (typeof value === 'object') {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = encode(v);
    }
    return out;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  throw new Error(`cannot encode ${typeof value}`);
}

const BIG = /^-?\d+$/;

/** Parse a decimal string field as bigint (strict). */
export function big(v: Json | undefined, label = 'value'): bigint {
  if (typeof v !== 'string' || !BIG.test(v))
    throw new Error(`${label}: expected decimal string, got ${JSON.stringify(v)}`);
  return BigInt(v);
}

export function num(v: Json | undefined, label = 'value'): number {
  if (typeof v !== 'number') throw new Error(`${label}: expected number`);
  return v;
}

export function str(v: Json | undefined, label = 'value'): string {
  if (typeof v !== 'string') throw new Error(`${label}: expected string`);
  return v;
}

export function bool(v: Json | undefined, label = 'value'): boolean {
  if (typeof v !== 'boolean') throw new Error(`${label}: expected boolean`);
  return v;
}

export function obj(v: Json | undefined, label = 'value'): { [k: string]: Json } {
  if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${label}: expected object`);
  }
  return v;
}

export function arr(v: Json | undefined, label = 'value'): Json[] {
  if (!Array.isArray(v)) throw new Error(`${label}: expected array`);
  return v;
}

export function optBig(v: Json | undefined, label = 'value'): bigint | null {
  return v === null || v === undefined ? null : big(v, label);
}

/** Stable JSON text (2-space, trailing newline) for committed files. */
export function stringify(value: unknown): string {
  return JSON.stringify(encode(value), null, 2) + '\n';
}

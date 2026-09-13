/** Unix seconds. Kept in one place so server components and hooks share the same clock helper. */
export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

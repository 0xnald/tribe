/** Text colour with the best WCAG contrast on an asset hue: Ink or Bone. */
export function onAsset(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#0e0f12';
  const n = parseInt(m[1]!, 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
  const INK = 0.0056; // #0e0f12
  const BONE = 0.875; // #f4f1ea
  const ink = (L + 0.05) / (INK + 0.05);
  const bone = (BONE + 0.05) / (L + 0.05);
  return ink >= bone ? '#0e0f12' : '#f4f1ea';
}

import 'server-only';

import { getNetworkConfig } from '../config/network';
import { withMarket } from '../market/snapshot';
import { getDevnetArena, listDevnetArenas } from '../protocol/service';
import { findFixtureDef, buildFixtureArena, listFixtureArenas } from './fixtures';
import type { ArenaView } from './model';

/**
 * Arena repository: demo fixtures (always) + real devnet Arenas (when the
 * program has any), each decorated with live mainnet market context.
 * Failures in one source never hide the other.
 */
export async function listArenas(now = Math.floor(Date.now() / 1000)): Promise<ArenaView[]> {
  const fixtures = listFixtureArenas(now);
  const devnet = await listDevnetArenas(now).catch(() => []);
  const all = [...devnet.map((d) => d.view), ...fixtures];
  return decorate(all);
}

export async function getArena(
  slug: string,
  now = Math.floor(Date.now() / 1000),
): Promise<ArenaView | null> {
  if (slug.startsWith('devnet-')) {
    const d = await getDevnetArena(slug.slice('devnet-'.length), now).catch(() => null);
    if (!d) return null;
    const [v] = await decorate([d.view]);
    return v ?? null;
  }
  const def = findFixtureDef(slug);
  if (!def) return null;
  const [v] = await decorate([buildFixtureArena(def, now)]);
  return v ?? null;
}

async function decorate(arenas: ArenaView[]): Promise<ArenaView[]> {
  if (getNetworkConfig().mode === 'demo') return arenas;
  try {
    return await withMarket(arenas);
  } catch {
    return arenas;
  }
}

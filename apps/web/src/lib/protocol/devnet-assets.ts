/**
 * Devnet stand-in assets. The mainnet assets (BONK, SOL, xStocks…) do not
 * exist on devnet, so the devnet Tribe program is exercised with test mints
 * that borrow the mainnet asset's identity *and Pyth feed*: Pyth publishes
 * sponsored devnet price feeds for BONK, SOL, BTC, WIF and ETH, so a devnet
 * Arena settles on the same oracle a mainnet one would.
 *
 * Keyed by devnet mint. Filled in after `scripts/devnet-setup.ts` creates
 * the mints (values also exported through NEXT_PUBLIC_DEVNET_ASSETS so a
 * redeploy does not need a code change).
 */
export interface DevnetAssetAlias {
  /** Registry symbol whose identity, colour, logo and feed this mint stands in for. */
  standsFor: string;
  /** What the UI calls it — never the mainnet symbol alone. */
  label: string;
}

function parseEnv(): Record<string, DevnetAssetAlias> {
  const raw = process.env['NEXT_PUBLIC_DEVNET_ASSETS'];
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, DevnetAssetAlias>;
    return j;
  } catch {
    return {};
  }
}

/** Mints created by packages/program-client/tests/devnet-setup.test.ts on 2026-09-13 (devnet, public). */
const DEFAULTS: Record<string, DevnetAssetAlias> = {
  FhvxjAUEQ5W1zrfXGnd6QuzLaTaiDkbEY2aEWvjLCSuT: { standsFor: 'BONK', label: 'tBONK' },
  '348Kk3CBtzwTHvLMN3wd9yipsqvzJ1u4ST6E7mBNKZe3': { standsFor: 'SOL', label: 'tSOL' },
};

export const DEVNET_ASSETS: Record<string, DevnetAssetAlias> = {
  ...DEFAULTS,
  ...parseEnv(),
};

export function devnetAlias(mint: string): DevnetAssetAlias | undefined {
  return DEVNET_ASSETS[mint];
}

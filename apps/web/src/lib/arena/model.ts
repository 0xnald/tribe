/**
 * View model shared by the Explore feed, the Arena page, the Back sheet and
 * My Arenas. Numbers are plain floats for display; the bigint engine in
 * `@tribe/core` is only used where exact protocol arithmetic matters
 * (fees, multipliers, devnet transactions).
 */

/** Where a piece of data comes from. Every Arena, price and position carries one. */
export type Provenance = 'live' | 'devnet' | 'demo';

export type ArenaStatus =
  'scheduled' | 'live' | 'backing_closed' | 'settling' | 'settled' | 'cancelled';

export type SideKey = 'a' | 'b';

export type ArenaCategory =
  'meme-vs-stock' | 'crypto-vs-stock' | 'stock-vs-stock' | 'crypto-vs-crypto';

export interface AssetIdentity {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  color: string;
  logoUrl: string | null;
  classTag: string; // MEME · STOCK · INDEX · L1 · BTC
  category: 'Meme' | 'L1' | 'BtcWrapper' | 'Stock' | 'Etf' | 'Commodity';
  isXStock: boolean;
  marketHours: 'Always' | 'UsEquityRth';
}

export interface ArenaSideView {
  key: SideKey;
  asset: AssetIdentity;
  /** Arena reference price at start (USD). */
  startPrice: number;
  /** Current Arena reference price (USD). */
  price: number;
  /** Performance since Arena start, in percent (8.42 = +8.42 %). */
  perfPct: number;
  backingUsd: number;
  /** 0..1 share of total backing (by USD). */
  backingShare: number;
  participants: number;
  /** Current underdog multiplier for a new deposit on this side (1.0 = none). */
  multiplier: number;
}

export interface ActivityItem {
  id: string;
  ts: number;
  kind: 'back' | 'lead' | 'sponsor' | 'cutoff' | 'exit' | 'start' | 'settle';
  text: string;
  side?: SideKey;
  amountUsd?: number;
}

export interface PerfPoint {
  t: number;
  a: number;
  b: number;
}

export interface MarketQuote {
  mint: string;
  usdPrice: number | null;
  change24hPct: number | null;
  liquidityUsd: number | null;
  source: 'jupiter' | 'unavailable';
  fetchedAt: number;
  state: 'ok' | 'stale' | 'unavailable';
}

export interface MarketStatus {
  /** `open` for 24/7 crypto; equities follow the exchange calendar. */
  state: 'open' | 'closed' | 'halted' | 'unknown';
  period?: 'market' | 'extended' | 'overnight' | 'closed';
  nextChangeAt?: number;
  exchange?: string;
  source: 'xstocks' | 'pyth' | 'always' | 'unavailable';
  /** Oracle used for settlement (display). */
  oracle: string;
}

export interface SideMarket {
  quote: MarketQuote;
  status: MarketStatus;
}

export interface ArenaView {
  id: string;
  slug: string;
  provenance: Provenance;
  status: ArenaStatus;
  category: ArenaCategory;
  narrative: string;
  featured: boolean;
  trending: boolean;
  startTs: number;
  endTs: number;
  backingCloseTs: number;
  /** Seconds the underdog multiplier ramps in from Arena start. */
  warmupSecs: number;
  sides: [ArenaSideView, ArenaSideView];
  leader: SideKey | 'tie';
  /** Leader's performance minus the other side's, in percent points. */
  leadPct: number;
  totalBackingUsd: number;
  participants: number;
  rewardPoolUsd: number;
  sponsorUsd: number;
  feeBps: number;
  creator: { label: string; address: string | null; firstParty: boolean };
  history: PerfPoint[];
  activity: ActivityItem[];
  /** Live mainnet market context per side (may be unavailable). */
  market: [SideMarket, SideMarket] | null;
  winner?: SideKey | 'tie';
  /** Devnet-only: on-chain addresses. */
  onchain?: { arena: string; creator: string; nonce: string };
}

/** Seconds remaining until the next relevant boundary, and which label applies. */
export function arenaCountdown(a: ArenaView, now: number): { label: string; secs: number } {
  switch (a.status) {
    case 'scheduled':
      return { label: 'OPENS IN', secs: a.startTs - now };
    case 'live':
      return now < a.backingCloseTs
        ? { label: 'BACKING CLOSES IN', secs: a.backingCloseTs - now }
        : { label: 'ENDS IN', secs: a.endTs - now };
    case 'backing_closed':
      return { label: 'ENDS IN', secs: a.endTs - now };
    case 'settling':
      return { label: 'SETTLING', secs: 0 };
    case 'settled':
      return { label: 'SETTLED', secs: 0 };
    case 'cancelled':
      return { label: 'CANCELLED', secs: 0 };
  }
}

export function otherSide(k: SideKey): SideKey {
  return k === 'a' ? 'b' : 'a';
}

export function sideOf(a: ArenaView, k: SideKey): ArenaSideView {
  return k === 'a' ? a.sides[0] : a.sides[1];
}

export function isBackable(a: ArenaView, now: number): boolean {
  return a.status === 'live' && now < a.backingCloseTs;
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  live: 'LIVE',
  devnet: 'DEVNET',
  demo: 'DEMO',
};

export const PROVENANCE_HELP: Record<Provenance, string> = {
  live: 'Live mainnet market data.',
  devnet:
    'Real transaction on the Tribe program on Solana devnet. Devnet test tokens stand in for the mainnet assets.',
  demo: 'Demo Arena — simulated Arena prices and backing for presentation. No transaction is sent.',
};

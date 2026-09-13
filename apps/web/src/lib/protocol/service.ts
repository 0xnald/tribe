import 'server-only';

import {
  DEFAULT_ARENA_PARAMS,
  ONE_Q4,
  findAsset,
  rampMultiplierQ4,
  rawMultiplierQ4,
  warmupSecs,
} from '@tribe/core';
import {
  PYTH_RECEIVER_PROGRAM_ID,
  TribeClient,
  decodePriceUpdateV2,
  readonlyProvider,
  type ArenaAccount,
  type ConfigAccount,
  type PositionAccount,
} from '@tribe/program-client';
import { Connection, PublicKey } from '@solana/web3.js';

import type { ArenaSideView, ArenaStatus, ArenaView, AssetIdentity, SideKey } from '../arena/model';
import { getNetworkConfig } from '../config/network';
import { cached } from '../market/cache';
import { devnetAlias } from './devnet-assets';

/**
 * Reads from the deployed tribe_arena program on the protocol cluster.
 * Everything here is real on-chain state (provenance `devnet` today).
 */
const PYTH_PUSH_ORACLE = new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT');

let client: TribeClient | null = null;
let connection: Connection | null = null;

function conn(): Connection {
  if (!connection) {
    // Public devnet RPC rate-limits getProgramAccounts; never block a page on retries.
    connection = new Connection(getNetworkConfig().protocol.rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
    });
  }
  return connection;
}

/** Hard cap on how long a page render waits for the protocol cluster. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('protocol rpc timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function tribe(): TribeClient {
  if (!client) {
    client = new TribeClient(
      readonlyProvider(conn()),
      new PublicKey(getNetworkConfig().protocol.programId),
    );
  }
  return client;
}

export interface ProtocolStatus {
  cluster: string;
  programId: string;
  programFound: boolean;
  executable: boolean;
  configFound: boolean;
  authority: string | null;
  paused: boolean;
  feeBps: number | null;
  arenaCount: number;
  checkedAt: number;
}

export async function getProtocolStatus(): Promise<ProtocolStatus> {
  const cfg = getNetworkConfig();
  const res = await cached('protocol:status', 60_000, async () => {
    const c = conn();
    const pid = new PublicKey(cfg.protocol.programId);
    const info = await c.getAccountInfo(pid);
    let config: ConfigAccount | null = null;
    let arenaCount = 0;
    if (info) {
      config = await tribe().program.account.protocolConfig.fetchNullable(tribe().config());
      arenaCount = (await withTimeout(tribe().program.account.arena.all(), 5000)).length;
    }
    const status: ProtocolStatus = {
      cluster: cfg.protocol.cluster,
      programId: cfg.protocol.programId,
      programFound: !!info,
      executable: !!info?.executable,
      configFound: !!config,
      authority: config ? config.authority.toBase58() : null,
      paused: config?.paused ?? false,
      feeBps: config ? config.feePolicy.feeBps : null,
      arenaCount,
      checkedAt: Date.now(),
    };
    return status;
  });
  return (
    res?.value ?? {
      cluster: cfg.protocol.cluster,
      programId: cfg.protocol.programId,
      programFound: false,
      executable: false,
      configFound: false,
      authority: null,
      paused: false,
      feeBps: null,
      arenaCount: 0,
      checkedAt: Date.now(),
    }
  );
}

/** Pyth sponsored devnet feed account (push-oracle PDA, shard 0). */
function feedAccount(feedIdHex: string): PublicKey {
  const shard = Buffer.alloc(2);
  shard.writeUInt16LE(0);
  return PublicKey.findProgramAddressSync(
    [shard, Buffer.from(feedIdHex, 'hex')],
    PYTH_PUSH_ORACLE,
  )[0];
}

interface FeedPrice {
  price: number;
  publishTime: number;
}

async function readFeed(feedIdHex: string): Promise<FeedPrice | null> {
  const res = await cached(`pyth:devnet:${feedIdHex}`, 20_000, async () => {
    const info = await withTimeout(conn().getAccountInfo(feedAccount(feedIdHex)), 4000);
    if (!info || !info.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) return null;
    const f = decodePriceUpdateV2(info.data);
    return { price: Number(f.price) * 10 ** f.exponent, publishTime: Number(f.publishTime) };
  });
  return res?.value ?? null;
}

function identityFor(mint: string, decimals: number): AssetIdentity {
  const alias = devnetAlias(mint);
  const reg = alias ? findAsset(alias.standsFor) : undefined;
  if (reg) {
    return {
      symbol: alias?.label ?? reg.displaySymbol,
      name: `${reg.name} (devnet stand-in)`,
      mint,
      decimals,
      color: reg.visual.color,
      logoUrl: reg.visual.logoUrl,
      classTag: reg.visual.classTag,
      category: reg.category,
      isXStock: false,
      marketHours: reg.marketHours,
    };
  }
  return {
    symbol: `${mint.slice(0, 4)}…`,
    name: 'Devnet token',
    mint,
    decimals,
    color: '#9A9FAA',
    logoUrl: null,
    classTag: 'DEVNET',
    category: 'L1',
    isXStock: false,
    marketHours: 'Always',
  };
}

function statusOf(a: ArenaAccount, now: number): ArenaStatus {
  const s = a.status;
  if (s === 3) return 'cancelled';
  if (s === 2) return 'settled';
  if (s === 0) return 'scheduled';
  const end = Number(a.endTs);
  if (now >= end) return 'settling';
  if (now >= Number(a.backingCloseTs)) return 'backing_closed';
  return 'live';
}

export interface DevnetArena {
  view: ArenaView;
  account: ArenaAccount;
  address: PublicKey;
}

export async function listDevnetArenas(
  now = Math.floor(Date.now() / 1000),
): Promise<DevnetArena[]> {
  const res = await cached('protocol:arenas', 30_000, () =>
    withTimeout(tribe().program.account.arena.all(), 5000),
  );
  const rows = res?.value ?? [];
  const out: DevnetArena[] = [];
  for (const row of rows) {
    const view = await toView(row.account, row.publicKey, now);
    out.push({ view, account: row.account, address: row.publicKey });
  }
  return out.sort((x, y) => y.view.startTs - x.view.startTs);
}

export async function getDevnetArena(
  address: string,
  now = Math.floor(Date.now() / 1000),
): Promise<DevnetArena | null> {
  let pk: PublicKey;
  try {
    pk = new PublicKey(address);
  } catch {
    return null;
  }
  const res = await cached(`protocol:arena:${address}`, 15_000, () =>
    withTimeout(tribe().program.account.arena.fetchNullable(pk), 5000),
  );
  if (!res?.value) return null;
  return { view: await toView(res.value, pk, now), account: res.value, address: pk };
}

async function toView(a: ArenaAccount, address: PublicKey, now: number): Promise<ArenaView> {
  const status = statusOf(a, now);
  const startTs = Number(a.startTs);
  const endTs = Number(a.endTs);
  const duration = endTs - startTs;
  const [aa, ab] = a.assets;
  const [sp0, sp1] = a.startPrices;
  const [ep0, ep1] = a.endPrices;
  const [sd0, sd1] = a.sides;
  if (!aa || !ab || !sp0 || !sp1 || !ep0 || !ep1 || !sd0 || !sd1)
    throw new Error('malformed arena account');
  const idA = identityFor(aa.mint.toBase58(), aa.decimals);
  const idB = identityFor(ab.mint.toBase58(), ab.decimals);
  const feedA = Buffer.from(aa.feedId).toString('hex');
  const feedB = Buffer.from(ab.feedId).toString('hex');
  const startA = Number(sp0.priceQ8) / 1e8;
  const startB = Number(sp1.priceQ8) / 1e8;
  const started = a.status >= 1 && startA > 0 && startB > 0;
  const ended = a.status === 2;
  const [liveA, liveB] =
    started && !ended ? await Promise.all([readFeed(feedA), readFeed(feedB)]) : [null, null];
  const curA = ended ? Number(ep0.priceQ8) / 1e8 : (liveA?.price ?? startA);
  const curB = ended ? Number(ep1.priceQ8) / 1e8 : (liveB?.price ?? startB);
  const perf = (s: number, c: number): number =>
    s > 0 ? Math.round(((c - s) / s) * 10_000) / 100 : 0;
  const perfA = started ? perf(startA, curA) : 0;
  const perfB = started ? perf(startB, curB) : 0;

  const unitsA = Number(sd0.units) / 10 ** aa.decimals;
  const unitsB = Number(sd1.units) / 10 ** ab.decimals;
  const backA = unitsA * curA;
  const backB = unitsB * curB;
  const total = backA + backB;
  const shareA = total > 0 ? backA / total : 0.5;
  const participants = sd0.participants + sd1.participants;
  const params = DEFAULT_ARENA_PARAMS;
  const warmup = Number(warmupSecs(BigInt(Math.max(1, duration)), params.underdog));
  const mult = (share: number): number => {
    if (status !== 'live') return 1;
    const raw = rawMultiplierQ4(BigInt(Math.round(share * 10_000)), params.underdog);
    const m = rampMultiplierQ4(raw, BigInt(Math.max(0, now - startTs)), BigInt(warmup));
    return Number(m) / Number(ONE_Q4);
  };
  const side = (
    key: SideKey,
    asset: AssetIdentity,
    start: number,
    cur: number,
    p: number,
    backing: number,
    share: number,
    parts: number,
  ): ArenaSideView => ({
    key,
    asset,
    startPrice: start,
    price: cur,
    perfPct: p,
    backingUsd: backing,
    backingShare: share,
    participants: parts,
    multiplier: mult(share),
  });
  const diff = Math.round((perfA - perfB) * 100) / 100;
  const leader: SideKey | 'tie' = !started || Math.abs(diff) < 0.005 ? 'tie' : diff > 0 ? 'a' : 'b';
  const slug = `devnet-${address.toBase58()}`;
  const view: ArenaView = {
    id: `devnet:${address.toBase58()}`,
    slug,
    provenance: 'devnet',
    status,
    category: 'crypto-vs-crypto',
    narrative: 'Devnet protocol',
    featured: false,
    trending: false,
    startTs,
    endTs,
    backingCloseTs: Number(a.backingCloseTs),
    warmupSecs: warmup,
    sides: [
      side('a', idA, startA, curA, perfA, backA, shareA, sd0.participants),
      side('b', idB, startB, curB, perfB, backB, 1 - shareA, sd1.participants),
    ],
    leader,
    leadPct: Math.abs(diff),
    totalBackingUsd: total,
    participants,
    rewardPoolUsd: Number(a.rewardPoolBalance) / 1e6,
    sponsorUsd: Number(a.sponsorTotal) / 1e6,
    feeBps: a.feePolicy.feeBps,
    creator: {
      label: a.creator.toBase58().slice(0, 4) + '…' + a.creator.toBase58().slice(-4),
      address: a.creator.toBase58(),
      firstParty: a.creatorTarget !== 0,
    },
    history: [],
    activity: [],
    market: null,
    onchain: {
      arena: address.toBase58(),
      creator: a.creator.toBase58(),
      nonce: a.nonce.toString(),
    },
  };
  if (ended) {
    const w = a.settlement.winner;
    view.winner = w === 0 ? 'a' : w === 1 ? 'b' : 'tie';
  }
  return view;
}

export interface DevnetPosition {
  address: string;
  arena: string;
  side: SideKey;
  units: number;
  entryTs: number;
  claimed: boolean;
  forfeited: boolean;
  deposits: number;
}

export async function listDevnetPositions(owner: string): Promise<DevnetPosition[]> {
  let pk: PublicKey;
  try {
    pk = new PublicKey(owner);
  } catch {
    return [];
  }
  const res = await cached(`protocol:positions:${owner}`, 15_000, () =>
    withTimeout(
      tribe().program.account.position.all([{ memcmp: { offset: 8, bytes: pk.toBase58() } }]),
      6000,
    ),
  );
  return (res?.value ?? []).map((r) => {
    const p: PositionAccount = r.account;
    return {
      address: r.publicKey.toBase58(),
      arena: p.arena.toBase58(),
      side: p.side === 0 ? 'a' : 'b',
      units: Number(p.units),
      entryTs: Number(p.entryTs),
      claimed: p.claimed,
      forfeited: p.forfeited,
      deposits: p.deposits,
    };
  });
}

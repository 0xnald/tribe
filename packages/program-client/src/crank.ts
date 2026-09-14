/**
 * Tribe crank — permissionless Arena maintenance.
 *
 *   snapshot_start   Scheduled Arena whose start has passed, while both feeds
 *                    have a fresh enough update (the program re-checks).
 *   settle           Live Arena past its end, within the settlement deadline.
 *   cancel_expired   Scheduled Arena never started in its grace window, or a
 *                    Live Arena whose settlement deadline passed.
 *   sweep_unclaimed  Settled Arena after the claim window.
 *
 * Needs only a low-value fee-paying signer: none of these instructions is
 * privileged. Every action is pre-checked against on-chain state with the
 * same rules the program enforces, so repeated runs never spam transactions;
 * the program guards make double submission harmless anyway.
 *
 * Price updates come from Pyth's sponsored push-oracle accounts (fresh for
 * major crypto feeds on mainnet and devnet). When a feed is not fresh within
 * the Arena's tolerance — equities out of hours, or a crank that ran late —
 * the action is reported as `needs_hermes`: posting a historical update
 * requires a Hermes API key and the receiver's post_update flow, which is
 * not wired here yet.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import { TribeClient, readonlyProvider, type ArenaAccount, type ConfigAccount } from './client';
import { PYTH_RECEIVER_PROGRAM_ID } from './pda';
import { decodePriceUpdateV2 } from './pyth';

export const PYTH_PUSH_ORACLE_PROGRAM_ID = new PublicKey(
  'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT',
);

const STATUS = { SCHEDULED: 0, LIVE: 1, SETTLED: 2, CANCELLED: 3 } as const;

export type Action =
  | { kind: 'snapshot_start' | 'settle' | 'cancel_expired' | 'sweep_unclaimed'; arena: string }
  | { kind: 'needs_hermes'; arena: string; step: 'snapshot_start' | 'settle'; reason: string }
  | { kind: 'wait'; arena: string; reason: string };

export interface FeedSnapshot {
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: number;
  fullyVerified: boolean;
  feedId: string;
}

/** Sponsored price feed account for a feed id (push oracle PDA, shard 0). */
export function sponsoredFeedAccount(feedIdHex: string, shard = 0): PublicKey {
  const s = Buffer.alloc(2);
  s.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync(
    [s, Buffer.from(feedIdHex, 'hex')],
    PYTH_PUSH_ORACLE_PROGRAM_ID,
  )[0];
}

/** Mirrors engine/oracle.rs timing + verification checks for one side. */
export function feedAcceptable(
  f: FeedSnapshot | null,
  asset: ArenaAccount['assets'][number],
  targetTs: number,
  allowClosed: boolean,
): { ok: boolean; reason: string } {
  if (!f) return { ok: false, reason: 'no sponsored feed account' };
  if (f.feedId !== Buffer.from(asset.feedId).toString('hex'))
    return { ok: false, reason: 'feed id mismatch' };
  if (!f.fullyVerified) return { ok: false, reason: 'not fully verified' };
  if (f.price <= 0n) return { ok: false, reason: 'non-positive price' };
  const confBps = (f.conf * 10_000n) / f.price;
  if (confBps > BigInt(asset.maxConfBps))
    return { ok: false, reason: `confidence ${confBps} bps > ${asset.maxConfBps}` };
  const diff = f.publishTime - targetTs;
  const tol = Number(asset.toleranceSecs);
  if (Math.abs(diff) <= tol) return { ok: true, reason: 'exact' };
  if (diff > 0) return { ok: false, reason: `publish ${diff}s after target` };
  const lastKnown =
    allowClosed && asset.assetClass !== 0 && Number(asset.maxClosedStalenessSecs) > 0;
  if (lastKnown && -diff <= Number(asset.maxClosedStalenessSecs))
    return { ok: true, reason: 'last-known' };
  return { ok: false, reason: `publish ${-diff}s before target (tolerance ${tol}s)` };
}

/** Pure planner: what should happen to this Arena now. Tested without a cluster. */
export function planArena(
  a: ArenaAccount,
  address: PublicKey,
  now: number,
  feeds: [FeedSnapshot | null, FeedSnapshot | null],
  cfg: ConfigAccount,
): Action {
  const arena = address.toBase58();
  const start = Number(a.startTs);
  const end = Number(a.endTs);
  const grace = Number(a.params.settlementGraceSecs);
  const deadline = end + grace + Number(a.extensionSecs);
  const [fa, fb] = feeds;
  const [aa, ab] = a.assets;
  if (!aa || !ab) return { kind: 'wait', arena, reason: 'malformed' };
  switch (a.status) {
    case STATUS.SCHEDULED: {
      if (now < start) return { kind: 'wait', arena, reason: `starts in ${start - now}s` };
      if (now > start + grace) return { kind: 'cancel_expired', arena };
      const ra = feedAcceptable(fa, aa, start, a.allowClosedSettlement);
      const rb = feedAcceptable(fb, ab, start, a.allowClosedSettlement);
      if (ra.ok && rb.ok) return { kind: 'snapshot_start', arena };
      return {
        kind: 'needs_hermes',
        arena,
        step: 'snapshot_start',
        reason: `${ra.ok ? '' : `A: ${ra.reason}`} ${rb.ok ? '' : `B: ${rb.reason}`}`.trim(),
      };
    }
    case STATUS.LIVE: {
      if (now < end) return { kind: 'wait', arena, reason: `ends in ${end - now}s` };
      if (now > deadline) return { kind: 'cancel_expired', arena };
      const ra = feedAcceptable(fa, aa, end, a.allowClosedSettlement);
      const rb = feedAcceptable(fb, ab, end, a.allowClosedSettlement);
      if (ra.ok && rb.ok) return { kind: 'settle', arena };
      return {
        kind: 'needs_hermes',
        arena,
        step: 'settle',
        reason: `${ra.ok ? '' : `A: ${ra.reason}`} ${rb.ok ? '' : `B: ${rb.reason}`}`.trim(),
      };
    }
    case STATUS.SETTLED: {
      const settledAt = Number(a.settlement.settledAt);
      const claimWindow = Number(cfg.limits.claimWindowSecs);
      if (Number(a.claimsSweptAt) !== 0) return { kind: 'wait', arena, reason: 'swept' };
      if (now <= settledAt + claimWindow)
        return {
          kind: 'wait',
          arena,
          reason: `claim window open for ${settledAt + claimWindow - now}s`,
        };
      return { kind: 'sweep_unclaimed', arena };
    }
    default:
      return { kind: 'wait', arena, reason: 'cancelled' };
  }
}

export interface CrankOptions {
  rpcUrl: string;
  programId: PublicKey;
  signer: Keypair;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface CrankResult {
  actions: Action[];
  signatures: Array<{ arena: string; kind: string; signature: string }>;
  errors: Array<{ arena: string; kind: string; error: string }>;
}

async function readFeed(connection: Connection, feedIdHex: string): Promise<FeedSnapshot | null> {
  const info = await connection.getAccountInfo(sponsoredFeedAccount(feedIdHex));
  if (!info || !info.owner.equals(PYTH_RECEIVER_PROGRAM_ID)) return null;
  const d = decodePriceUpdateV2(info.data);
  return {
    price: d.price,
    conf: d.conf,
    exponent: d.exponent,
    publishTime: Number(d.publishTime),
    fullyVerified: d.verificationLevel === 'Full',
    feedId: Buffer.from(d.feedId).toString('hex'),
  };
}

/** One pass over every Arena. Safe to call on a timer. */
export async function crankOnce(opts: CrankOptions): Promise<CrankResult> {
  const log =
    opts.log ??
    ((l: string) => {
      console.log(`[crank] ${l}`);
    });
  const connection = new Connection(opts.rpcUrl, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
  });
  const client = new TribeClient(readonlyProvider(connection), opts.programId);
  const cfg = await client.fetchConfig();
  const arenas = await client.program.account.arena.all();
  const now = Math.floor(Date.now() / 1000);
  const result: CrankResult = { actions: [], signatures: [], errors: [] };
  const feedCache = new Map<string, FeedSnapshot | null>();
  const feed = async (hex: string): Promise<FeedSnapshot | null> => {
    if (!feedCache.has(hex)) feedCache.set(hex, await readFeed(connection, hex).catch(() => null));
    return feedCache.get(hex) ?? null;
  };
  for (const { publicKey, account } of arenas) {
    const [aa, ab] = account.assets;
    if (!aa || !ab) continue;
    const fa = await feed(Buffer.from(aa.feedId).toString('hex'));
    const fb = await feed(Buffer.from(ab.feedId).toString('hex'));
    const action = planArena(account, publicKey, now, [fa, fb], cfg);
    result.actions.push(action);
    if (action.kind === 'wait' || action.kind === 'needs_hermes') {
      log(
        `${publicKey.toBase58()} status=${account.status} → ${action.kind}${'reason' in action ? ` (${action.reason})` : ''}`,
      );
      continue;
    }
    log(
      `${publicKey.toBase58()} status=${account.status} → ${action.kind}${opts.dryRun ? ' (dry run)' : ''}`,
    );
    if (opts.dryRun) continue;
    try {
      const cranker = opts.signer.publicKey;
      const feedA = sponsoredFeedAccount(Buffer.from(aa.feedId).toString('hex'));
      const feedB = sponsoredFeedAccount(Buffer.from(ab.feedId).toString('hex'));
      const ix =
        action.kind === 'snapshot_start'
          ? await client.snapshotStart(cranker, publicKey, account, feedA, feedB)
          : action.kind === 'settle'
            ? await client.settle(cranker, publicKey, account, cfg, feedA, feedB)
            : action.kind === 'cancel_expired'
              ? await client.cancelExpired(cranker, publicKey)
              : await client.sweepUnclaimed(cranker, publicKey, account, cfg);
      const sig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(ix),
        [opts.signer],
        {
          commitment: 'confirmed',
          maxRetries: 3,
        },
      );
      result.signatures.push({ arena: publicKey.toBase58(), kind: action.kind, signature: sig });
      log(`  ✓ ${action.kind} ${sig}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push({
        arena: publicKey.toBase58(),
        kind: action.kind,
        error: msg.slice(0, 200),
      });
      log(`  ✗ ${action.kind} ${msg.slice(0, 200)}`);
    }
  }
  return result;
}

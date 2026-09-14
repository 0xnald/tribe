import { BN } from '@anchor-lang/core';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import type { ArenaAccount, ConfigAccount } from './client';
import { feedAcceptable, planArena, sponsoredFeedAccount, type FeedSnapshot } from './crank';

const BONK = '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419';
const SOL = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
const NOW = 1_800_000_000;

function asset(
  feed: string,
  over: Partial<ArenaAccount['assets'][number]> = {},
): ArenaAccount['assets'][number] {
  return {
    mint: Keypair.generate().publicKey,
    tokenProgram: Keypair.generate().publicKey,
    decimals: 5,
    assetClass: 0,
    feedId: Array.from(Buffer.from(feed, 'hex')),
    scaledUi: false,
    toleranceSecs: new BN(60),
    maxClosedStalenessSecs: new BN(0),
    maxConfBps: 100,
    ...over,
  };
}

function arena(status: number, over: Partial<ArenaAccount> = {}): ArenaAccount {
  return {
    status,
    startTs: new BN(NOW - 3600),
    endTs: new BN(NOW + 3600),
    extensionSecs: new BN(0),
    allowClosedSettlement: false,
    assets: [asset(BONK), asset(SOL)],
    params: { settlementGraceSecs: new BN(6 * 3600) },
    settlement: { settledAt: new BN(0) },
    claimsSweptAt: new BN(0),
    ...over,
  } as unknown as ArenaAccount;
}

function feed(feedId: string, publishTime: number, over: Partial<FeedSnapshot> = {}): FeedSnapshot {
  return {
    price: 100_000n,
    conf: 50n,
    exponent: -8,
    publishTime,
    fullyVerified: true,
    feedId,
    ...over,
  };
}

const cfg = { limits: { claimWindowSecs: new BN(30 * 86_400) } } as unknown as ConfigAccount;
const addr = Keypair.generate().publicKey;

describe('feedAcceptable (mirrors engine/oracle.rs)', () => {
  const a = asset(BONK);
  it('accepts within tolerance, rejects the rest', () => {
    expect(feedAcceptable(feed(BONK, NOW - 30), a, NOW, false).ok).toBe(true);
    expect(feedAcceptable(feed(BONK, NOW + 61), a, NOW, false)).toMatchObject({
      ok: false,
      reason: /after target/,
    });
    expect(feedAcceptable(feed(BONK, NOW - 61), a, NOW, false)).toMatchObject({
      ok: false,
      reason: /before target/,
    });
    expect(feedAcceptable(feed(SOL, NOW), a, NOW, false)).toMatchObject({
      ok: false,
      reason: /feed id/,
    });
    expect(feedAcceptable(feed(BONK, NOW, { fullyVerified: false }), a, NOW, false)).toMatchObject({
      ok: false,
      reason: /verified/,
    });
    expect(feedAcceptable(feed(BONK, NOW, { conf: 5000n }), a, NOW, false)).toMatchObject({
      ok: false,
      reason: /confidence/,
    });
    expect(feedAcceptable(null, a, NOW, false)).toMatchObject({ ok: false });
  });
  it('last-known applies to equities with closed settlement only', () => {
    const eq = asset(BONK, { assetClass: 1, maxClosedStalenessSecs: new BN(72 * 3600) });
    expect(feedAcceptable(feed(BONK, NOW - 5 * 3600), eq, NOW, true)).toMatchObject({
      ok: true,
      reason: 'last-known',
    });
    expect(feedAcceptable(feed(BONK, NOW - 5 * 3600), eq, NOW, false).ok).toBe(false);
    expect(
      feedAcceptable(
        feed(BONK, NOW - 5 * 3600),
        asset(BONK, { maxClosedStalenessSecs: new BN(72 * 3600) }),
        NOW,
        true,
      ).ok,
    ).toBe(false); // crypto never
  });
});

describe('planArena', () => {
  it('waits before start, starts when both feeds are fresh, cancels after grace', () => {
    const fresh: [FeedSnapshot, FeedSnapshot] = [feed(BONK, NOW - 3590), feed(SOL, NOW - 3590)];
    expect(planArena(arena(0, { startTs: new BN(NOW + 10) }), addr, NOW, fresh, cfg).kind).toBe(
      'wait',
    );
    expect(planArena(arena(0), addr, NOW - 3590, fresh, cfg).kind).toBe('snapshot_start');
    const late: [FeedSnapshot, FeedSnapshot] = [feed(BONK, NOW - 3000), feed(SOL, NOW - 3000)];
    expect(planArena(arena(0), addr, NOW - 3000, late, cfg).kind).toBe('needs_hermes');
    expect(planArena(arena(0), addr, NOW + 6 * 3600, fresh, cfg).kind).toBe('cancel_expired');
  });
  it('settles at end with fresh feeds, flags stale feeds, cancels past the deadline', () => {
    const live = arena(1, { startTs: new BN(NOW - 7200), endTs: new BN(NOW - 30) });
    expect(planArena(live, addr, NOW, [feed(BONK, NOW - 40), feed(SOL, NOW - 35)], cfg).kind).toBe(
      'settle',
    );
    expect(
      planArena(live, addr, NOW, [feed(BONK, NOW - 40), feed(SOL, NOW - 3000)], cfg),
    ).toMatchObject({ kind: 'needs_hermes', step: 'settle' });
    expect(
      planArena(live, addr, NOW - 100, [feed(BONK, NOW - 40), feed(SOL, NOW - 35)], cfg).kind,
    ).toBe('wait');
    expect(planArena(live, addr, NOW + 7 * 3600, [null, null], cfg).kind).toBe('cancel_expired');
  });
  it('sweeps only after the claim window and only once', () => {
    const settled = arena(2, {
      settlement: { settledAt: new BN(NOW - 31 * 86_400) },
    } as unknown as Partial<ArenaAccount>);
    expect(planArena(settled, addr, NOW, [null, null], cfg).kind).toBe('sweep_unclaimed');
    expect(
      planArena(
        arena(2, {
          settlement: { settledAt: new BN(NOW - 86_400) },
        } as unknown as Partial<ArenaAccount>),
        addr,
        NOW,
        [null, null],
        cfg,
      ).kind,
    ).toBe('wait');
    expect(
      planArena(
        arena(2, {
          settlement: { settledAt: new BN(NOW - 31 * 86_400) },
          claimsSweptAt: new BN(NOW - 5),
        } as unknown as Partial<ArenaAccount>),
        addr,
        NOW,
        [null, null],
        cfg,
      ).kind,
    ).toBe('wait');
    expect(planArena(arena(3), addr, NOW, [null, null], cfg).kind).toBe('wait');
  });
  it('derives the sponsored feed PDA the Pyth push oracle uses', () => {
    expect(
      sponsoredFeedAccount(BONK).equals(
        new PublicKey('DBE3N8uNjhKPRHfANdwGvCZghWXyLPdqdSbEW2XFwBiX'),
      ),
    ).toBe(true);
    expect(
      sponsoredFeedAccount(SOL).equals(
        new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'),
      ),
    ).toBe(true);
  });
});

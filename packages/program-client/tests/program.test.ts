/**
 * tribe_arena integration tests under bankrun (solana-program-test): real token accounts (legacy SPL
 * and Token-2022 with xStocks-like extensions), fabricated Pyth accounts owned
 * by the receiver program, and a controlled clock. Run in WSL/Linux:
 *   pnpm --filter @tribe/program-client test:program
 */
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  TRIBE_ARENA_PROGRAM_ID,
  TribeClient,
  ata,
  readonlyProvider,
  type ArenaAccount,
  type ConfigAccount,
} from '../src';
import {
  airdrop,
  createAta,
  createMint,
  createSvm,
  expectError,
  mintTo,
  priceUpdateFixture,
  send,
  setClock,
  setPriceUpdate,
  tokenBalance,
  type Svm,
} from './harness';

const HOUR = 3600n;
const DAY = 24n * HOUR;
const T0 = 1_800_000_000n;
const BONK_FEED = '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419';
const TSLA_FEED = '16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1';
const BONK_PRICE = 281n; // Q8
const TSLA_PRICE = 36_525_000_000n;

const feePolicy = {
  feeBps: 50,
  rewardPoolBps: 4000,
  protocolBps: 4000,
  creatorBps: 2000,
  firstPartyCreatorTarget: 2,
};
const limits = {
  minDurationSecs: HOUR,
  maxDurationSecs: 30n * DAY,
  minLeadSecs: 60n,
  claimWindowSecs: 30n * DAY,
  maxExtensionSecs: DAY,
  reserveDrawBps: 1000,
  upsetBonusCapUsdc: 5_000_000_000n,
};
const params = {
  tieBps: 1,
  minHoldBps: 1000,
  minHoldFloorSecs: 900n,
  underdog: { slope: 2, capQ4: 20_000, warmupBps: 1000, warmupFloorSecs: 1800n },
  settlementGraceSecs: 6n * HOUR,
  minBackingUsdc: 5_000_000n,
};

/** Units of a side worth `usd` at its start price. */
function unitsFor(usd: bigint, priceQ8: bigint, decimals: number): bigint {
  return (usd * 100_000_000n * 10n ** BigInt(decimals)) / priceQ8;
}
function feeFor(units: bigint, priceQ8: bigint, decimals: number): bigint {
  const notional = (units * priceQ8) / 10n ** BigInt(decimals + 2);
  return (notional * 50n) / 10_000n;
}

interface World {
  h: Svm;
  client: TribeClient;
  authority: Keypair;
  creator: Keypair;
  alice: Keypair;
  bob: Keypair;
  carol: Keypair;
  sponsor: Keypair;
  usdc: PublicKey;
  bonk: PublicKey; // legacy, 5 dp
  tslax: PublicKey; // Token-2022 scaled-ui, 8 dp
  treasury: PublicKey;
  cfg: ConfigAccount;
}

const W = {} as World;
let nonce = 1n;

async function fetchArena(arena: PublicKey): Promise<ArenaAccount> {
  const info = await W.h.svm.getAccount(arena);
  if (!info) throw new Error('arena missing');
  return W.client.program.coder.accounts.decode('arena', Buffer.from(info.data)) as ArenaAccount;
}
async function fetchPosition(arena: PublicKey, side: 0 | 1, owner: PublicKey) {
  const info = await W.h.svm.getAccount(W.client.position(arena, side, owner));
  if (!info) return null;
  return W.client.program.coder.accounts.decode('position', Buffer.from(info.data));
}
async function fetchConfig(): Promise<ConfigAccount> {
  const info = await W.h.svm.getAccount(W.client.config());
  if (!info) throw new Error('config missing');
  return W.client.program.coder.accounts.decode(
    'protocolConfig',
    Buffer.from(info.data),
  ) as ConfigAccount;
}

function pythAccount(
  feed: string,
  price: bigint,
  publishTime: bigint,
  extra: Parameters<typeof priceUpdateFixture>[3] = {},
): PublicKey {
  const k = Keypair.generate().publicKey;
  setPriceUpdate(W.h, k, priceUpdateFixture(feed, price, publishTime, extra));
  return k;
}

async function createArena(
  opts: {
    start?: bigint;
    duration?: bigint;
    a?: PublicKey;
    b?: PublicKey;
    sponsorOpen?: boolean;
    firstParty?: boolean;
  } = {},
) {
  const startTs = opts.start ?? (await W.h.svm.getClock()).unixTimestamp + HOUR;
  const endTs = startTs + (opts.duration ?? DAY);
  const n = nonce++;
  const { arena, instruction } = await W.client.createArena(
    W.creator.publicKey,
    opts.a ?? W.bonk,
    opts.b ?? W.tslax,
    W.usdc,
    {
      nonce: n,
      startTs,
      endTs,
      allowClosedSettlement: false,
      sponsorOpen: opts.sponsorOpen ?? true,
      firstParty: opts.firstParty ?? false,
    },
  );
  await send(W.h, [instruction], [W.creator]);
  return { arena, startTs, endTs, nonce: n };
}

async function startArena(
  arena: PublicKey,
  startTs: bigint,
  prices: { a?: bigint; b?: bigint } = {},
) {
  await setClock(W.h, startTs);
  const a = await fetchArena(arena);
  const pa = pythAccount(BONK_FEED, prices.a ?? BONK_PRICE, startTs);
  const pb = pythAccount(TSLA_FEED, prices.b ?? TSLA_PRICE, startTs);
  await send(
    W.h,
    [await W.client.snapshotStart(W.h.payer.publicKey, arena, a, pa, pb)],
    [W.h.payer],
  );
}

async function back(
  user: Keypair,
  arena: PublicKey,
  side: 0 | 1,
  usd: bigint,
  feeOverride?: bigint,
) {
  const a = await fetchArena(arena);
  const price = side === 0 ? BONK_PRICE : TSLA_PRICE;
  const dec = side === 0 ? 5 : 8;
  const units = unitsFor(usd, price, dec);
  const fee = feeOverride ?? feeFor(units, price, dec);
  await send(W.h, await W.client.openAndBack(user.publicKey, arena, a, W.cfg, side, units, fee), [
    user,
  ]);
  return units;
}

async function settle(
  arena: PublicKey,
  endTs: bigint,
  prices: { a: bigint; b: bigint },
  at = endTs,
) {
  await setClock(W.h, at);
  const a = await fetchArena(arena);
  const pa = pythAccount(BONK_FEED, prices.a, endTs);
  const pb = pythAccount(TSLA_FEED, prices.b, endTs);
  await send(
    W.h,
    [await W.client.settle(W.h.payer.publicKey, arena, a, W.cfg, pa, pb)],
    [W.h.payer],
  );
}

beforeAll(async () => {
  W.h = await createSvm(TRIBE_ARENA_PROGRAM_ID);
  await setClock(W.h, T0);
  W.client = new TribeClient(
    readonlyProvider(new Connection('http://127.0.0.1:1')),
    TRIBE_ARENA_PROGRAM_ID,
  );
  W.authority = Keypair.generate();
  W.creator = Keypair.generate();
  W.alice = Keypair.generate();
  W.bob = Keypair.generate();
  W.carol = Keypair.generate();
  W.sponsor = Keypair.generate();
  for (const k of [W.authority, W.creator, W.alice, W.bob, W.carol, W.sponsor])
    await airdrop(W.h, k.publicKey);
  W.usdc = (await createMint(W.h, W.authority, { decimals: 6 })).mint;
  W.bonk = (await createMint(W.h, W.authority, { decimals: 5 })).mint;
  W.tslax = (
    await createMint(W.h, W.authority, {
      program: TOKEN_2022_PROGRAM_ID,
      decimals: 8,
      scaledUi: 1,
      pausable: true,
      permanentDelegate: W.authority.publicKey,
      transferHook: null,
    })
  ).mint;
  // balances
  for (const k of [W.alice, W.bob, W.carol, W.sponsor, W.creator]) {
    const u = await createAta(W.h, k, k.publicKey, W.usdc, TOKEN_PROGRAM_ID);
    await mintTo(W.h, W.authority, W.usdc, u, 1_000_000_000_000n, TOKEN_PROGRAM_ID); // 1M USDC
    const b = await createAta(W.h, k, k.publicKey, W.bonk, TOKEN_PROGRAM_ID);
    await mintTo(W.h, W.authority, W.bonk, b, 10_000_000_000_000_000n, TOKEN_PROGRAM_ID); // 100B BONK
    const t = await createAta(W.h, k, k.publicKey, W.tslax, TOKEN_2022_PROGRAM_ID);
    await mintTo(W.h, W.authority, W.tslax, t, 100_000_000_000_000n, TOKEN_2022_PROGRAM_ID); // 1M TSLAx
  }
  W.treasury = await createAta(W.h, W.authority, W.authority.publicKey, W.usdc, TOKEN_PROGRAM_ID);
});

describe('protocol initialization & asset registration', () => {
  it('init_config creates config and the upset reserve ATA', async () => {
    await send(
      W.h,
      [
        await W.client.initConfig(W.authority.publicKey, W.usdc, W.treasury, {
          feePolicy,
          limits,
          defaultParams: params,
        }),
      ],
      [W.authority],
    );
    W.cfg = await fetchConfig();
    expect(W.cfg.authority.equals(W.authority.publicKey)).toBe(true);
    expect(W.cfg.treasury.equals(W.treasury)).toBe(true);
    expect(W.cfg.upsetReserve.equals(ata(W.client.config(), W.usdc, TOKEN_PROGRAM_ID))).toBe(true);
    expect(W.cfg.feePolicy.feeBps).toBe(50);
    // fund the reserve with 10 000 USDC
    await mintTo(W.h, W.authority, W.usdc, W.cfg.upsetReserve, 10_000_000_000n, TOKEN_PROGRAM_ID);
  });

  it('init_config twice fails (reinitialization)', async () => {
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.initConfig(W.authority.publicKey, W.usdc, W.treasury, {
              feePolicy,
              limits,
              defaultParams: params,
            }),
          ],
          [W.authority],
        ),
      'AccountAlreadyInUse',
    );
  });

  it('registers a legacy SPL asset and a Token-2022 xStock-like asset', async () => {
    await send(
      W.h,
      [
        await W.client.setAsset(W.authority.publicKey, W.bonk, TOKEN_PROGRAM_ID, {
          assetClass: 0,
          feedId: Buffer.from(BONK_FEED, 'hex'),
          toleranceSecs: 60n,
          maxClosedStalenessSecs: 0n,
          maxConfBps: 100,
          status: 0,
        }),
      ],
      [W.authority],
    );
    await send(
      W.h,
      [
        await W.client.setAsset(W.authority.publicKey, W.tslax, TOKEN_2022_PROGRAM_ID, {
          assetClass: 1,
          feedId: Buffer.from(TSLA_FEED, 'hex'),
          toleranceSecs: 120n,
          maxClosedStalenessSecs: 72n * HOUR,
          maxConfBps: 50,
          status: 0,
        }),
      ],
      [W.authority],
    );
    const b = W.client.program.coder.accounts.decode(
      'assetEntry',
      Buffer.from((await W.h.svm.getAccount(W.client.asset(W.tslax)))!.data),
    );
    expect(b.scaledUi).toBe(true);
    expect(b.decimals).toBe(8);
    expect(b.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });

  it('rejects a transfer-fee Token-2022 mint', async () => {
    const bad = (
      await createMint(W.h, W.authority, {
        program: TOKEN_2022_PROGRAM_ID,
        decimals: 6,
        transferFeeBps: 100,
      })
    ).mint;
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.setAsset(W.authority.publicKey, bad, TOKEN_2022_PROGRAM_ID, {
              assetClass: 0,
              feedId: Buffer.from(BONK_FEED, 'hex'),
              toleranceSecs: 60n,
              maxClosedStalenessSecs: 0n,
              maxConfBps: 100,
              status: 0,
            }),
          ],
          [W.authority],
        ),
      'UnsupportedExtension',
    );
  });

  it('rejects a mint with an active transfer hook program', async () => {
    const hooked = (
      await createMint(W.h, W.authority, {
        program: TOKEN_2022_PROGRAM_ID,
        decimals: 6,
        transferHook: Keypair.generate().publicKey,
      })
    ).mint;
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.setAsset(W.authority.publicKey, hooked, TOKEN_2022_PROGRAM_ID, {
              assetClass: 0,
              feedId: Buffer.from(BONK_FEED, 'hex'),
              toleranceSecs: 60n,
              maxClosedStalenessSecs: 0n,
              maxConfBps: 100,
              status: 0,
            }),
          ],
          [W.authority],
        ),
      'ActiveTransferHook',
    );
  });

  it('rejects a wrong token program for the mint', async () => {
    const e = await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.setAsset(W.authority.publicKey, W.tslax, TOKEN_PROGRAM_ID, {
              assetClass: 1,
              feedId: Buffer.from(TSLA_FEED, 'hex'),
              toleranceSecs: 120n,
              maxClosedStalenessSecs: 0n,
              maxConfBps: 50,
              status: 0,
            }),
          ],
          [W.authority],
        ),
      'ConstraintMintTokenProgram',
    );
    expect(e).toBeTruthy();
  });

  it('non-authority cannot register assets', async () => {
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.setAsset(W.alice.publicKey, W.bonk, TOKEN_PROGRAM_ID, {
              assetClass: 0,
              feedId: Buffer.from(BONK_FEED, 'hex'),
              toleranceSecs: 60n,
              maxClosedStalenessSecs: 0n,
              maxConfBps: 100,
              status: 0,
            }),
          ],
          [W.alice],
        ),
      'Unauthorized',
    );
  });
});

describe('arena creation', () => {
  it('rejects unregistered mints, identical assets and bad durations', async () => {
    const unregistered = (await createMint(W.h, W.authority, { decimals: 6 })).mint;
    const now = (await W.h.svm.getClock()).unixTimestamp;
    await expectError(
      async () =>
        await send(
          W.h,
          [
            (
              await W.client.createArena(W.creator.publicKey, unregistered, W.tslax, W.usdc, {
                nonce: 900n,
                startTs: now + HOUR,
                endTs: now + DAY,
                allowClosedSettlement: false,
                sponsorOpen: true,
                firstParty: false,
              })
            ).instruction,
          ],
          [W.creator],
        ),
      'AccountNotInitialized',
    );
    await expectError(
      async () =>
        await send(
          W.h,
          [
            (
              await W.client.createArena(W.creator.publicKey, W.bonk, W.bonk, W.usdc, {
                nonce: 901n,
                startTs: now + HOUR,
                endTs: now + DAY,
                allowClosedSettlement: false,
                sponsorOpen: true,
                firstParty: false,
              })
            ).instruction,
          ],
          [W.creator],
        ),
      'SameAsset',
    );
    await expectError(
      async () =>
        await send(
          W.h,
          [
            (
              await W.client.createArena(W.creator.publicKey, W.bonk, W.tslax, W.usdc, {
                nonce: 902n,
                startTs: now + HOUR,
                endTs: now + HOUR + 600n,
                allowClosedSettlement: false,
                sponsorOpen: true,
                firstParty: false,
              })
            ).instruction,
          ],
          [W.creator],
        ),
      'InvalidParams',
    );
    await expectError(
      async () =>
        await send(
          W.h,
          [
            (
              await W.client.createArena(W.creator.publicKey, W.bonk, W.tslax, W.usdc, {
                nonce: 903n,
                startTs: now + 10n,
                endTs: now + DAY,
                allowClosedSettlement: false,
                sponsorOpen: true,
                firstParty: false,
              })
            ).instruction,
          ],
          [W.creator],
        ),
      'TooLate',
    );
  });

  it('creates an arena with a reward vault and derived backing cutoff', async () => {
    const { arena, startTs, endTs } = await createArena();
    const a = await fetchArena(arena);
    expect(a.status).toBe(0);
    expect(BigInt(a.backingCloseTs.toString())).toBe(endTs - 8640n);
    expect(BigInt(a.startTs.toString())).toBe(startTs);
    expect(a.rewardVault.equals(ata(arena, W.usdc, TOKEN_PROGRAM_ID))).toBe(true);
    expect(await tokenBalance(W.h, a.rewardVault)).toBe(0n);
  });
});

describe('happy path: BONK vs TSLAx, BONK wins', () => {
  let arena: PublicKey;
  let startTs: bigint;
  let endTs: bigint;
  let aliceUnits = 0n;
  let bobUnits = 0n;
  let carolUnits = 0n;
  let bobBonkBefore = 0n;
  let bobTslaBefore = 0n;

  it('sponsor funds 25 000 USDC before start', async () => {
    ({ arena, startTs, endTs } = await createArena());
    const a = await fetchArena(arena);
    await send(
      W.h,
      [await W.client.fundRewardPool(W.sponsor.publicKey, arena, a, W.usdc, 25_000_000_000n)],
      [W.sponsor],
    );
    const a2 = await fetchArena(arena);
    expect(BigInt(a2.rewardPoolBalance.toString())).toBe(25_000_000_000n);
    expect(await tokenBalance(W.h, a2.rewardVault)).toBe(25_000_000_000n);
    expect(BigInt(a2.sponsorTotal.toString())).toBe(25_000_000_000n);
  });

  it('back before start is rejected; start snapshot guards', async () => {
    const a = await fetchArena(arena);
    await expectError(
      async () =>
        await send(
          W.h,
          await W.client.openAndBack(W.alice.publicKey, arena, a, W.cfg, 0, 1n, 1n),
          [W.alice],
        ),
      'InvalidStatus',
    );
    // too early
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.snapshotStart(
              W.h.payer.publicKey,
              arena,
              a,
              pythAccount(BONK_FEED, BONK_PRICE, startTs),
              pythAccount(TSLA_FEED, TSLA_PRICE, startTs),
            ),
          ],
          [W.h.payer],
        ),
      'TooEarly',
    );
    await setClock(W.h, startTs);
    // wrong feed on side A
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.snapshotStart(
              W.h.payer.publicKey,
              arena,
              a,
              pythAccount(TSLA_FEED, BONK_PRICE, startTs),
              pythAccount(TSLA_FEED, TSLA_PRICE, startTs),
            ),
          ],
          [W.h.payer],
        ),
      'OracleFeedMismatch',
    );
    // stale
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.snapshotStart(
              W.h.payer.publicKey,
              arena,
              a,
              pythAccount(BONK_FEED, BONK_PRICE, startTs - 61n),
              pythAccount(TSLA_FEED, TSLA_PRICE, startTs),
            ),
          ],
          [W.h.payer],
        ),
      'OracleStale',
    );
    // partially verified
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.snapshotStart(
              W.h.payer.publicKey,
              arena,
              a,
              pythAccount(BONK_FEED, BONK_PRICE, startTs, { verificationLevel: { partial: 3 } }),
              pythAccount(TSLA_FEED, TSLA_PRICE, startTs),
            ),
          ],
          [W.h.payer],
        ),
      'OracleNotFullyVerified',
    );
    // account not owned by the Pyth receiver
    const fake = Keypair.generate().publicKey;
    W.h.svm.setAccount(fake, {
      lamports: 10_000_000,
      data: (await W.h.svm.getAccount(pythAccount(BONK_FEED, BONK_PRICE, startTs)))!.data,
      owner: Keypair.generate().publicKey,
      executable: false,
    });
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.snapshotStart(
              W.h.payer.publicKey,
              arena,
              a,
              fake,
              pythAccount(TSLA_FEED, TSLA_PRICE, startTs),
            ),
          ],
          [W.h.payer],
        ),
      'AccountOwnedByWrongProgram',
    );
    // ok
    await startArena(arena, startTs);
    const live = await fetchArena(arena);
    expect(live.status).toBe(1);
    expect(BigInt(live.startPrices[0]!.priceQ8.toString())).toBe(BONK_PRICE);
    expect(BigInt(live.startPrices[1]!.priceQ8.toString())).toBe(TSLA_PRICE);
    expect(BigInt(live.startPrices[1]!.multQ6.toString())).toBe(1_000_000n);
    // duplicate start
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.snapshotStart(
              W.h.payer.publicKey,
              arena,
              live,
              pythAccount(BONK_FEED, BONK_PRICE, startTs),
              pythAccount(TSLA_FEED, TSLA_PRICE, startTs),
            ),
          ],
          [W.h.payer],
        ),
      'InvalidStatus',
    );
  });

  it('alice backs BONK (legacy SPL) with existing holdings; fees route 40/40/20', async () => {
    const treasuryBefore = await tokenBalance(W.h, W.treasury);
    const creatorUsdc = ata(W.creator.publicKey, W.usdc, TOKEN_PROGRAM_ID);
    const creatorBefore = await tokenBalance(W.h, creatorUsdc);
    const aliceBonkBefore = await tokenBalance(
      W.h,
      ata(W.alice.publicKey, W.bonk, TOKEN_PROGRAM_ID),
    );
    aliceUnits = await back(W.alice, arena, 0, 1000n);
    const fee = feeFor(aliceUnits, BONK_PRICE, 5);
    const a = await fetchArena(arena);
    const pos = (await fetchPosition(arena, 0, W.alice.publicKey))!;
    expect(BigInt(pos.units.toString())).toBe(aliceUnits);
    expect(pos.deposits).toBe(1);
    expect(BigInt(a.sides[0]!.units.toString())).toBe(aliceUnits);
    expect(a.sides[0]!.participants).toBe(1);
    // principal in the position vault, gone from alice
    const vault = ata(W.client.position(arena, 0, W.alice.publicKey), W.bonk, TOKEN_PROGRAM_ID);
    expect(await tokenBalance(W.h, vault)).toBe(aliceUnits);
    expect(await tokenBalance(W.h, ata(W.alice.publicKey, W.bonk, TOKEN_PROGRAM_ID))).toBe(
      aliceBonkBefore - aliceUnits,
    );
    // fee legs
    expect(BigInt(a.rewardPoolBalance.toString())).toBe(25_000_000_000n + (fee * 4000n) / 10_000n);
    expect((await tokenBalance(W.h, W.treasury)) - treasuryBefore).toBe(
      fee - (fee * 4000n) / 10_000n - (fee * 2000n) / 10_000n,
    );
    expect((await tokenBalance(W.h, creatorUsdc)) - creatorBefore).toBe((fee * 2000n) / 10_000n);
    expect(BigInt(a.creatorFees.toString())).toBe((fee * 2000n) / 10_000n);
  });

  it('bob backs TSLAx (Token-2022) and carol backs BONK later', async () => {
    bobBonkBefore = await tokenBalance(W.h, ata(W.bob.publicKey, W.bonk, TOKEN_PROGRAM_ID));
    bobTslaBefore = await tokenBalance(W.h, ata(W.bob.publicKey, W.tslax, TOKEN_2022_PROGRAM_ID));
    bobUnits = await back(W.bob, arena, 1, 5000n);
    const vault = ata(W.client.position(arena, 1, W.bob.publicKey), W.tslax, TOKEN_2022_PROGRAM_ID);
    expect(await tokenBalance(W.h, vault)).toBe(bobUnits);
    await setClock(W.h, startTs + 12n * HOUR);
    carolUnits = await back(W.carol, arena, 0, 1000n);
    const a = await fetchArena(arena);
    expect(a.sides[0]!.participants).toBe(2);
    expect(BigInt(a.sides[0]!.units.toString())).toBe(aliceUnits + carolUnits);
    // TWAB accrued for 12h on both sides
    expect(BigInt(a.sides[0]!.unitSeconds.toString())).toBe(aliceUnits * 12n * HOUR);
    expect(BigInt(a.sides[1]!.unitSeconds.toString())).toBe(bobUnits * 12n * HOUR);
  });

  it('rejects wrong mint, wrong token program, fee too low, below minimum, foreign token account, substituted vault', async () => {
    const a = await fetchArena(arena);
    const units = unitsFor(100n, BONK_PRICE, 5);
    const fee = feeFor(units, BONK_PRICE, 5);
    await expectError(
      async () =>
        await send(
          W.h,
          [await W.client.back(W.alice.publicKey, arena, a, W.cfg, 0, units, fee - 1n)],
          [W.alice],
        ),
      'FeeTooLow',
    );
    await expectError(
      async () =>
        await send(
          W.h,
          [await W.client.back(W.alice.publicKey, arena, a, W.cfg, 0, 1_000n, 0n)],
          [W.alice],
        ),
      'BelowMinimumBacking',
    );
    // wrong mint: pass TSLAx accounts for side 0
    const good = await W.client.back(W.alice.publicKey, arena, a, W.cfg, 0, units, fee);
    const swapKey = (ixn: TransactionInstruction, from: PublicKey, to: PublicKey) => {
      const clone = {
        ...ixn,
        keys: ixn.keys.map((k) => (k.pubkey.equals(from) ? { ...k, pubkey: to } : k)),
      } as TransactionInstruction;
      return clone;
    };
    await expectError(
      async () => await send(W.h, [swapKey(good, W.bonk, W.tslax)], [W.alice]),
      'MintMismatch',
    );
    await expectError(
      async () =>
        await send(W.h, [swapKey(good, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID)], [W.alice]),
      'ConstraintMintTokenProgram',
    );
    // owner_asset belonging to bob
    await expectError(
      async () =>
        await send(
          W.h,
          [
            swapKey(
              good,
              ata(W.alice.publicKey, W.bonk, TOKEN_PROGRAM_ID),
              ata(W.bob.publicKey, W.bonk, TOKEN_PROGRAM_ID),
            ),
          ],
          [W.alice],
        ),
      'ConstraintTokenOwner',
    );
    // position vault substituted with bob's vault
    const aliceVault = ata(
      W.client.position(arena, 0, W.alice.publicKey),
      W.bonk,
      TOKEN_PROGRAM_ID,
    );
    const carolVault = ata(
      W.client.position(arena, 0, W.carol.publicKey),
      W.bonk,
      TOKEN_PROGRAM_ID,
    );
    await expectError(
      async () => await send(W.h, [swapKey(good, aliceVault, carolVault)], [W.alice]),
      'ConstraintTokenOwner',
    );
    // reward vault substituted with alice's own USDC account
    await expectError(
      async () =>
        await send(
          W.h,
          [swapKey(good, a.rewardVault, ata(W.alice.publicKey, W.usdc, TOKEN_PROGRAM_ID))],
          [W.alice],
        ),
      'ConstraintAddress',
    );
  });

  it('partial early exit forfeits proportionally; unauthorized exit and destination substitution fail', async () => {
    const a = await fetchArena(arena);
    await setClock(W.h, startTs + 13n * HOUR);
    // bob tries to exit alice's position
    await expectError(
      async () => await send(W.h, [await W.client.exit(W.bob.publicKey, arena, a, 0, 1n)], [W.bob]),
      'AccountNotInitialized',
    );
    const okIx = await W.client.exit(W.alice.publicKey, arena, a, 0, aliceUnits / 4n);
    // destination owned by bob
    const sub = {
      ...okIx,
      keys: okIx.keys.map((k) =>
        k.pubkey.equals(ata(W.alice.publicKey, W.bonk, TOKEN_PROGRAM_ID))
          ? { ...k, pubkey: ata(W.bob.publicKey, W.bonk, TOKEN_PROGRAM_ID) }
          : k,
      ),
    } as TransactionInstruction;
    await expectError(async () => await send(W.h, [sub], [W.alice]), 'ConstraintTokenOwner');
    const before = (await fetchPosition(arena, 0, W.alice.publicKey))!;
    await send(W.h, [okIx], [W.alice]);
    const after = (await fetchPosition(arena, 0, W.alice.publicKey))!;
    expect(BigInt(after.units.toString())).toBe(aliceUnits - aliceUnits / 4n);
    expect(after.forfeited).toBe(false);
    // accrued weight (brought to the exit time) reduced by ~25 %
    const dt = startTs + 13n * HOUR - BigInt(before.lastTouchTs.toString());
    const effBefore =
      BigInt(before.effUnitSeconds.toString()) + BigInt(before.effUnits.toString()) * dt;
    const effAfter = BigInt(after.effUnitSeconds.toString());
    expect(effAfter).toBeLessThan(effBefore);
    expect(effAfter).toBeGreaterThan((effBefore * 74n) / 100n);
    aliceUnits = aliceUnits - aliceUnits / 4n;
  });

  it('backing after the cutoff is rejected', async () => {
    const a = await fetchArena(arena);
    await setClock(W.h, BigInt(a.backingCloseTs.toString()));
    const units = unitsFor(100n, BONK_PRICE, 5);
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.back(
              W.alice.publicKey,
              arena,
              a,
              W.cfg,
              0,
              units,
              feeFor(units, BONK_PRICE, 5),
            ),
          ],
          [W.alice],
        ),
      'BackingClosed',
    );
  });

  it('settle: too early, then BONK +6.76 % wins; upset bonus from reserve; duplicate rejected', async () => {
    const a = await fetchArena(arena);
    await setClock(W.h, endTs - 1n);
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.settle(
              W.h.payer.publicKey,
              arena,
              a,
              W.cfg,
              pythAccount(BONK_FEED, 300n, endTs),
              pythAccount(TSLA_FEED, TSLA_PRICE, endTs),
            ),
          ],
          [W.h.payer],
        ),
      'TooEarly',
    );
    const reserveBefore = await tokenBalance(W.h, W.cfg.upsetReserve);
    await settle(arena, endTs, { a: 300n, b: TSLA_PRICE }, endTs + 2n * HOUR); // late crank, exact-window price
    const s = await fetchArena(arena);
    expect(s.status).toBe(2);
    expect(s.settlement.winner).toBe(0);
    expect(BigInt(s.settlement.perfBpsA.toString())).toBe(676n);
    expect(BigInt(s.settlement.perfBpsB.toString())).toBe(0n);
    // A was the ~28 % side by TWAB (2k vs 5k USD) → upset bonus > 0, capped by 10 % reserve draw = 1 000 USDC
    const bonus = BigInt(s.settlement.upsetBonus.toString());
    expect(bonus).toBeGreaterThan(0n);
    expect(bonus).toBeLessThanOrEqual(1_000_000_000n);
    expect(reserveBefore - (await tokenBalance(W.h, W.cfg.upsetReserve))).toBe(bonus);
    expect(BigInt(s.settlement.poolAtSettlement.toString())).toBe(
      BigInt(s.rewardPoolBalance.toString()),
    );
    expect(await tokenBalance(W.h, s.rewardVault)).toBe(BigInt(s.rewardPoolBalance.toString()));
    expect(BigInt(s.settlement.wTotal.toString())).toBeGreaterThan(0n);
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.settle(
              W.h.payer.publicKey,
              arena,
              s,
              W.cfg,
              pythAccount(BONK_FEED, 300n, endTs),
              pythAccount(TSLA_FEED, TSLA_PRICE, endTs),
            ),
          ],
          [W.h.payer],
        ),
      'AlreadySettled',
    );
  });

  it('claims: losing side rejected, winners paid proportionally, Σ ≤ pool, duplicates rejected, destination must be the claimant', async () => {
    const s = await fetchArena(arena);
    await expectError(
      async () =>
        await send(W.h, [await W.client.claim(W.bob.publicKey, arena, s, W.cfg, 1)], [W.bob]),
      'NotWinningSide',
    );
    const pool = BigInt(s.settlement.poolAtSettlement.toString());
    const wTotal = BigInt(s.settlement.wTotal.toString());
    let paid = 0n;
    for (const who of [W.alice, W.carol]) {
      const usdcAcc = ata(who.publicKey, W.usdc, TOKEN_PROGRAM_ID);
      const before = await tokenBalance(W.h, usdcAcc);
      await send(W.h, [await W.client.claim(who.publicKey, arena, s, W.cfg, 0)], [who]);
      const got = (await tokenBalance(W.h, usdcAcc)) - before;
      const p = (await fetchPosition(arena, 0, who.publicKey))!;
      expect(p.claimed).toBe(true);
      // proportional to the clamped weight
      const w =
        BigInt(p.effUnitSeconds.toString()) <
        BigInt(p.unitSeconds.toString()) * BigInt(s.settlement.mSettleQ4)
          ? BigInt(p.effUnitSeconds.toString())
          : BigInt(p.unitSeconds.toString()) * BigInt(s.settlement.mSettleQ4);
      expect(got).toBe((pool * w) / wTotal);
      paid += got;
      await expectError(
        async () =>
          await send(W.h, [await W.client.claim(who.publicKey, arena, s, W.cfg, 0)], [who]),
        'AlreadyClaimed',
      );
    }
    expect(paid).toBeLessThanOrEqual(pool);
    expect(paid).toBeGreaterThan((pool * 99n) / 100n); // no cap: only dust remains
    const after = await fetchArena(arena);
    expect(BigInt(after.totalClaimed.toString())).toBe(paid);
    expect(await tokenBalance(W.h, after.rewardVault)).toBe(pool - paid);
  });

  it('principal: winners and losers withdraw exactly what they deposited; losing principal never moves', async () => {
    const s = await fetchArena(arena);
    // bob (loser) withdraws all TSLAx
    await send(W.h, [await W.client.exit(W.bob.publicKey, arena, s, 1, bobUnits)], [W.bob]);
    expect(await tokenBalance(W.h, ata(W.bob.publicKey, W.tslax, TOKEN_2022_PROGRAM_ID))).toBe(
      bobTslaBefore,
    );
    expect(await tokenBalance(W.h, ata(W.bob.publicKey, W.bonk, TOKEN_PROGRAM_ID))).toBe(
      bobBonkBefore,
    ); // no BONK ever moved to bob
    // alice's TSLAx balance never changed: no losing principal reached a winner
    expect(
      await tokenBalance(
        W.h,
        ata(W.client.position(arena, 1, W.bob.publicKey), W.tslax, TOKEN_2022_PROGRAM_ID),
      ),
    ).toBe(0n);
    // duplicate withdrawal
    await expectError(
      async () => await send(W.h, [await W.client.exit(W.bob.publicKey, arena, s, 1, 1n)], [W.bob]),
      'InsufficientUnits',
    );
    // winners withdraw remaining BONK; frozen weights untouched
    for (const [who, units] of [
      [W.alice, aliceUnits],
      [W.carol, carolUnits],
    ] as const) {
      const before = (await fetchPosition(arena, 0, who.publicKey))!;
      await send(W.h, [await W.client.exit(who.publicKey, arena, s, 0, units)], [who]);
      const after = (await fetchPosition(arena, 0, who.publicKey))!;
      expect(BigInt(after.units.toString())).toBe(0n);
      expect(after.effUnitSeconds.toString()).toBe(before.effUnitSeconds.toString());
      expect(
        await tokenBalance(
          W.h,
          ata(W.client.position(arena, 0, who.publicKey), W.bonk, TOKEN_PROGRAM_ID),
        ),
      ).toBe(0n);
    }
    // total BONK conserved: every unit deposited is back in user wallets
    let total = 0n;
    for (const k of [W.alice, W.bob, W.carol])
      total += await tokenBalance(W.h, ata(k.publicKey, W.bonk, TOKEN_PROGRAM_ID));
    expect(total).toBe(3n * 10_000_000_000_000_000n);
  });
});

describe('failure recovery: cancel_expired, sponsor refund, tie, sweep', () => {
  it('cancel_expired after the settlement window; positions withdrawable; sponsor refunded once', async () => {
    const { arena, startTs, endTs } = await createArena();
    const a0 = await fetchArena(arena);
    await send(
      W.h,
      [await W.client.fundRewardPool(W.sponsor.publicKey, arena, a0, W.usdc, 1_000_000_000n)],
      [W.sponsor],
    );
    await startArena(arena, startTs);
    const units = await back(W.alice, arena, 0, 500n);
    const a = await fetchArena(arena);
    await expectError(
      async () =>
        await send(
          W.h,
          [await W.client.refundSponsor(W.sponsor.publicKey, arena, a, W.cfg)],
          [W.sponsor],
        ),
      'RefundNotAvailable',
    );
    await setClock(W.h, endTs + 6n * HOUR);
    await expectError(
      async () =>
        await send(W.h, [await W.client.cancelExpired(W.h.payer.publicKey, arena)], [W.h.payer]),
      'NotExpired',
    );
    await setClock(W.h, endTs + 6n * HOUR + 1n);
    await send(W.h, [await W.client.cancelExpired(W.h.payer.publicKey, arena)], [W.h.payer]);
    const c = await fetchArena(arena);
    expect(c.status).toBe(3);
    // settlement now impossible
    await expectError(
      async () =>
        await send(
          W.h,
          [
            await W.client.settle(
              W.h.payer.publicKey,
              arena,
              c,
              W.cfg,
              pythAccount(BONK_FEED, 300n, endTs),
              pythAccount(TSLA_FEED, TSLA_PRICE, endTs),
            ),
          ],
          [W.h.payer],
        ),
      'InvalidStatus',
    );
    // withdraw principal without any operator
    const before = await tokenBalance(W.h, ata(W.alice.publicKey, W.bonk, TOKEN_PROGRAM_ID));
    await send(W.h, [await W.client.exit(W.alice.publicKey, arena, c, 0, units)], [W.alice]);
    expect(
      (await tokenBalance(W.h, ata(W.alice.publicKey, W.bonk, TOKEN_PROGRAM_ID))) - before,
    ).toBe(units);
    // sponsor refund
    const sBefore = await tokenBalance(W.h, ata(W.sponsor.publicKey, W.usdc, TOKEN_PROGRAM_ID));
    await send(
      W.h,
      [await W.client.refundSponsor(W.sponsor.publicKey, arena, c, W.cfg)],
      [W.sponsor],
    );
    expect(
      (await tokenBalance(W.h, ata(W.sponsor.publicKey, W.usdc, TOKEN_PROGRAM_ID))) - sBefore,
    ).toBe(1_000_000_000n);
    await expectError(
      async () =>
        await send(
          W.h,
          [await W.client.refundSponsor(W.sponsor.publicKey, arena, c, W.cfg)],
          [W.sponsor],
        ),
      'SponsorAlreadyRefunded',
    );
    // a non-sponsor cannot refund
    await expectError(
      async () =>
        await send(W.h, [await W.client.refundSponsor(W.bob.publicKey, arena, c, W.cfg)], [W.bob]),
      'AccountNotInitialized',
    );
  });

  it('tie: no claims, sponsor refundable, sweep only moves fee money', async () => {
    const { arena, startTs, endTs } = await createArena();
    const a0 = await fetchArena(arena);
    await send(
      W.h,
      [await W.client.fundRewardPool(W.sponsor.publicKey, arena, a0, W.usdc, 2_000_000_000n)],
      [W.sponsor],
    );
    await startArena(arena, startTs);
    await back(W.alice, arena, 0, 500n);
    await back(W.bob, arena, 1, 500n);
    await settle(arena, endTs, { a: BONK_PRICE, b: TSLA_PRICE });
    const s = await fetchArena(arena);
    expect(s.settlement.winner).toBe(2);
    await expectError(
      async () =>
        await send(W.h, [await W.client.claim(W.alice.publicKey, arena, s, W.cfg, 0)], [W.alice]),
      'NoWinner',
    );
    await expectError(
      async () =>
        await send(
          W.h,
          [await W.client.sweepUnclaimed(W.h.payer.publicKey, arena, s, W.cfg)],
          [W.h.payer],
        ),
      'TooEarly',
    );
    await setClock(W.h, endTs + 31n * DAY);
    const treasuryBefore = await tokenBalance(W.h, W.treasury);
    await send(
      W.h,
      [await W.client.sweepUnclaimed(W.h.payer.publicKey, arena, s, W.cfg)],
      [W.h.payer],
    );
    const swept = (await tokenBalance(W.h, W.treasury)) - treasuryBefore;
    const s2 = await fetchArena(arena);
    expect(BigInt(s2.rewardPoolBalance.toString())).toBe(2_000_000_000n); // sponsor money stays
    expect(BigInt(s2.rolloverOut.toString())).toBe(swept);
    await send(
      W.h,
      [await W.client.refundSponsor(W.sponsor.publicKey, arena, s2, W.cfg)],
      [W.sponsor],
    );
    expect(await tokenBalance(W.h, s2.rewardVault)).toBe(0n);
  });

  it('authority cancel + extension guards', async () => {
    const { arena, startTs, endTs } = await createArena();
    await startArena(arena, startTs);
    await expectError(
      async () =>
        await send(W.h, [await W.client.cancelArena(W.creator.publicKey, arena, 1)], [W.creator]),
      'Unauthorized',
    );
    await setClock(W.h, endTs);
    await send(
      W.h,
      [await W.client.extendSettlement(W.authority.publicKey, arena, DAY)],
      [W.authority],
    );
    await expectError(
      async () =>
        await send(
          W.h,
          [await W.client.extendSettlement(W.authority.publicKey, arena, HOUR)],
          [W.authority],
        ),
      'AlreadyExtended',
    );
    await send(W.h, [await W.client.cancelArena(W.authority.publicKey, arena, 7)], [W.authority]);
    expect((await fetchArena(arena)).status).toBe(3);
  });
});

describe('scaled-ui multiplier and pause', () => {
  it('a 2.0× ScaledUiAmount mint doubles the reference price at snapshot', async () => {
    const scaled = (
      await createMint(W.h, W.authority, {
        program: TOKEN_2022_PROGRAM_ID,
        decimals: 8,
        scaledUi: 2,
      })
    ).mint;
    await send(
      W.h,
      [
        await W.client.setAsset(W.authority.publicKey, scaled, TOKEN_2022_PROGRAM_ID, {
          assetClass: 1,
          feedId: Buffer.from(TSLA_FEED, 'hex'),
          toleranceSecs: 120n,
          maxClosedStalenessSecs: 72n * HOUR,
          maxConfBps: 50,
          status: 0,
        }),
      ],
      [W.authority],
    );
    const { arena, startTs } = await createArena({ b: scaled });
    await startArena(arena, startTs);
    const a = await fetchArena(arena);
    expect(BigInt(a.startPrices[1]!.multQ6.toString())).toBe(2_000_000n);
    expect(BigInt(a.startPrices[1]!.priceQ8.toString())).toBe(TSLA_PRICE * 2n);
  });

  it('pause blocks create_arena and back', async () => {
    await send(W.h, [await W.client.setPaused(W.authority.publicKey, true)], [W.authority]);
    const now = (await W.h.svm.getClock()).unixTimestamp;
    await expectError(
      async () =>
        await send(
          W.h,
          [
            (
              await W.client.createArena(W.creator.publicKey, W.bonk, W.tslax, W.usdc, {
                nonce: 950n,
                startTs: now + HOUR,
                endTs: now + DAY,
                allowClosedSettlement: false,
                sponsorOpen: true,
                firstParty: false,
              })
            ).instruction,
          ],
          [W.creator],
        ),
      'Paused',
    );
    await send(W.h, [await W.client.setPaused(W.authority.publicKey, false)], [W.authority]);
  });
});

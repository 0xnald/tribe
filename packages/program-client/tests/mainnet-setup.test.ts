/**
 * Mainnet bootstrap — verification first, writes only when explicitly armed.
 *
 *   MAINNET_SETUP=1 pnpm --filter @tribe/program-client exec vitest run --config vitest.program.config.ts tests/mainnet-setup.test.ts
 *
 * Default (no MAINNET_SETUP_WRITE): a dry run that reads mainnet and prints
 * the plan — every mint's owner program, decimals and Token-2022
 * extensions checked against the program's policy, every Pyth sponsored
 * feed account's freshness/confidence, USDC, and the rent the accounts
 * will cost. Nothing is signed.
 *
 * With MAINNET_SETUP_WRITE=1 and MAINNET_AUTHORITY_KEYPAIR (the upgrade
 * authority / protocol authority) it performs, in order and idempotently:
 *   1. init_config (real USDC, treasury = authority USDC ATA) if missing
 *   2. set_asset for the allowlist (BONK, SOL by default; MAINNET_ASSETS
 *      overrides, e.g. "BONK,SOL,TSLAx")
 *   3. optionally create_arena for the canary pair (MAINNET_CANARY=BONK,SOL
 *      plus MAINNET_CANARY_START_IN_SECS / MAINNET_CANARY_DURATION_SECS)
 * The keypair is read from a path; nothing is ever printed but public keys.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { findAsset } from '@tribe/core';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  PYTH_RECEIVER_PROGRAM_ID,
  TRIBE_ARENA_PROGRAM_ID,
  TribeClient,
  decodePriceUpdateV2,
  feedIdFromHex,
  readonlyProvider,
  sponsoredFeedAccount,
} from '../src';

const RPC = process.env['MAINNET_RPC'] ?? 'https://api.mainnet-beta.solana.com';
/** Canonical Circle USDC on Solana mainnet-beta. */
export const USDC_MAINNET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const UNSUPPORTED = new Set(['transferFeeConfig', 'nonTransferable', 'interestBearingConfig']);
const HOUR = 3600n;

/** Registration policy per asset class (the settlement window the crank must hit). */
function policy(symbol: string): {
  toleranceSecs: bigint;
  maxClosedStalenessSecs: bigint;
  maxConfBps: number;
  assetClass: number;
} {
  const a = findAsset(symbol);
  if (!a) throw new Error(`unknown asset ${symbol}`);
  const crypto = a.assetClass === 'Crypto';
  return {
    assetClass: crypto ? 0 : a.assetClass === 'Equity' ? 1 : a.assetClass === 'Etf' ? 2 : 3,
    toleranceSecs: 120n,
    maxClosedStalenessSecs: crypto ? 0n : 72n * HOUR,
    maxConfBps: crypto ? 100 : 50,
  };
}

interface ParsedMint {
  owner: string;
  decimals: number;
  extensions: string[];
  paused: boolean | null;
  hookProgram: string | null;
  multiplier: number | null;
}

async function inspectMint(c: Connection, mint: PublicKey): Promise<ParsedMint> {
  const info = await c.getParsedAccountInfo(mint);
  const v = info.value;
  if (!v || !('parsed' in v.data))
    throw new Error(`mint ${mint.toBase58()} not found or not parsed`);
  const p = v.data.parsed as {
    info: {
      decimals: number;
      extensions?: Array<{ extension: string; state?: Record<string, unknown> }>;
    };
  };
  const exts = p.info.extensions ?? [];
  const find = (n: string) => exts.find((e) => e.extension === n)?.state;
  const hook = find('transferHook');
  const pause = find('pausableConfig');
  const sui = find('scaledUiAmountConfig');
  return {
    owner: v.owner.toBase58(),
    decimals: p.info.decimals,
    extensions: exts.map((e) => e.extension),
    paused: pause ? Boolean(pause['paused']) : null,
    hookProgram: hook ? (hook['programId'] as string | null) : null,
    multiplier: sui ? Number(sui['multiplier']) : null,
  };
}

describe.skipIf(!process.env['MAINNET_SETUP'])('mainnet setup', () => {
  it(
    'verifies mainnet assets, feeds and USDC; writes only when armed',
    { timeout: 600_000 },
    async () => {
      const c = new Connection(RPC, 'confirmed');
      const write = process.env['MAINNET_SETUP_WRITE'] === '1';
      const symbols = (process.env['MAINNET_ASSETS'] ?? 'BONK,SOL').split(',').map((s) => s.trim());
      const lines: string[] = [];
      const log = (...a: unknown[]) => {
        const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
        lines.push(line);
        console.log('[mainnet-setup]', line);
        writeFileSync(
          process.env['MAINNET_SETUP_LOG'] ?? 'mainnet-setup.log',
          lines.join(String.fromCharCode(10)) + String.fromCharCode(10),
        );
      };

      // USDC
      const usdc = await inspectMint(c, USDC_MAINNET);
      expect(usdc.owner).toBe(TOKEN_PROGRAM_ID.toBase58());
      expect(usdc.decimals).toBe(6);
      log('USDC ok', USDC_MAINNET.toBase58(), 'decimals', usdc.decimals);

      // assets: live chain data checked against the program's Token-2022 policy
      const plan: Array<{
        symbol: string;
        mint: PublicKey;
        tokenProgram: PublicKey;
        feed: string;
      }> = [];
      for (const symbol of symbols) {
        const reg = findAsset(symbol);
        expect(reg, `registry has ${symbol}`).toBeDefined();
        if (!reg || !reg.pythFeedId) throw new Error(`${symbol} has no Pyth feed`);
        const mint = new PublicKey(reg.mint);
        const m = await inspectMint(c, mint);
        expect(m.decimals, `${symbol} decimals`).toBe(reg.decimals);
        const tokenProgram =
          m.owner === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        expect(m.owner, `${symbol} owner program`).toBe(tokenProgram.toBase58());
        for (const e of m.extensions)
          expect(UNSUPPORTED.has(e), `${symbol} has unsupported extension ${e}`).toBe(false);
        expect(m.hookProgram, `${symbol} active transfer hook`).toBeNull();
        expect(m.paused, `${symbol} paused`).not.toBe(true);
        // Pyth sponsored feed: exists, receiver-owned, fully verified, fresh, confident
        const feedPda = sponsoredFeedAccount(reg.pythFeedId);
        const fi = await c.getAccountInfo(feedPda);
        expect(fi, `${symbol} sponsored feed account`).not.toBeNull();
        expect(fi!.owner.equals(PYTH_RECEIVER_PROGRAM_ID)).toBe(true);
        const f = decodePriceUpdateV2(fi!.data);
        const age = Math.floor(Date.now() / 1000) - Number(f.publishTime);
        const confBps = Number((f.conf * 10_000n) / f.price);
        const pol = policy(symbol);
        log(
          symbol,
          mint.toBase58(),
          'program',
          tokenProgram.toBase58().slice(0, 8),
          'dec',
          m.decimals,
          'ext',
          m.extensions.join('|') || '-',
          'mult',
          m.multiplier ?? '-',
          '| feed',
          feedPda.toBase58(),
          'age',
          age + 's',
          'conf',
          confBps + 'bps',
          'verif',
          JSON.stringify(f.verificationLevel),
          '| policy tol',
          pol.toleranceSecs + 's',
          'conf<=',
          pol.maxConfBps,
        );
        expect(f.verificationLevel).toBe('Full');
        expect(confBps, `${symbol} confidence within policy`).toBeLessThanOrEqual(pol.maxConfBps);
        if (pol.assetClass === 0) expect(age, `${symbol} feed fresh`).toBeLessThan(600);
        plan.push({ symbol, mint, tokenProgram, feed: reg.pythFeedId });
      }

      // rent — exact account sizes from the IDL account coder; ATAs are legacy
      // SPL token accounts (USDC, BONK, wSOL are all legacy mints)
      const sizer = new TribeClient(readonlyProvider(c), TRIBE_ARENA_PROGRAM_ID).program.account;
      const rent = async (bytes: number) =>
        (await c.getMinimumBalanceForRentExemption(bytes)) / 1e9;
      const PROGRAM_SO_BYTES = Number(process.env['MAINNET_SO_BYTES'] ?? '639536');
      const sizes = {
        programAccount: 36,
        programData800k: 45 + 800_000,
        programDataExact: 45 + PROGRAM_SO_BYTES,
        config: sizer.protocolConfig.size,
        asset: sizer.assetEntry.size,
        arena: sizer.arena.size,
        sponsor: sizer.sponsor.size,
        position: sizer.position.size,
        ata: 165,
      };
      const r: Record<string, number> = {};
      for (const [k, v] of Object.entries(sizes)) r[k] = await rent(v);
      log('account sizes (bytes):', JSON.stringify(sizes));
      log('rent per account (SOL):', JSON.stringify(r));
      const deploy = r['programAccount']! + r['programData800k']!;
      const bootstrap = r['config']! + 2 * r['ata']! + 2 * r['asset']!; // config, reserve ATA, treasury ATA, BONK+SOL entries
      const canaryCreate = r['arena']! + r['ata']!; // Arena + reward vault
      const canarySponsor = r['sponsor']!;
      const canaryBacks = 2 * r['position']! + 2 * r['ata']!; // two Positions + two vault ATAs
      log(
        'rent totals (SOL):',
        JSON.stringify({
          deploy,
          bootstrap,
          canaryCreate,
          canarySponsor,
          canaryBacks,
          authorityTotal: deploy + bootstrap + canaryCreate,
          canaryWalletTotal: canarySponsor + canaryBacks,
          upgradeBufferTemporary: r['programDataExact'],
        }),
      );

      const client = new TribeClient(readonlyProvider(c), TRIBE_ARENA_PROGRAM_ID);
      const program = await c.getAccountInfo(TRIBE_ARENA_PROGRAM_ID);
      log(
        'program on mainnet:',
        program
          ? `deployed (${program.executable ? 'executable' : 'not executable'})`
          : 'NOT DEPLOYED',
      );
      const cfg = program
        ? await client.program.account.protocolConfig.fetchNullable(client.config())
        : null;
      log(
        'config:',
        cfg
          ? `authority ${cfg.authority.toBase58()} usdc ${cfg.usdcMint.toBase58()}`
          : 'not initialised',
      );

      if (!write) {
        log(
          'dry run — nothing signed. Set MAINNET_SETUP_WRITE=1 with MAINNET_AUTHORITY_KEYPAIR to bootstrap.',
        );
        return;
      }
      if (!program) throw new Error('deploy the program first (scripts/deploy-mainnet.sh)');
      const authority = Keypair.fromSecretKey(
        Uint8Array.from(
          JSON.parse(readFileSync(process.env['MAINNET_AUTHORITY_KEYPAIR']!, 'utf8')) as number[],
        ),
      );
      const send = (ixs: TransactionInstruction[]) =>
        sendAndConfirmTransaction(c, new Transaction().add(...ixs), [authority], {
          commitment: 'confirmed',
        });
      log('authority', authority.publicKey.toBase58());

      if (!cfg) {
        const treasury = getAssociatedTokenAddressSync(USDC_MAINNET, authority.publicKey);
        const sig = await send([
          createAssociatedTokenAccountIdempotentInstruction(
            authority.publicKey,
            treasury,
            authority.publicKey,
            USDC_MAINNET,
          ),
          await client.initConfig(authority.publicKey, USDC_MAINNET, treasury, {
            feePolicy: {
              feeBps: 50,
              rewardPoolBps: 4000,
              protocolBps: 4000,
              creatorBps: 2000,
              firstPartyCreatorTarget: 2,
            },
            limits: {
              minDurationSecs: HOUR,
              maxDurationSecs: 30n * 24n * HOUR,
              minLeadSecs: 60n,
              claimWindowSecs: 30n * 24n * HOUR,
              maxExtensionSecs: 24n * HOUR,
              reserveDrawBps: 1000,
              upsetBonusCapUsdc: 5_000_000_000n,
            },
            defaultParams: {
              tieBps: 1,
              minHoldBps: 1000,
              minHoldFloorSecs: 900n,
              underdog: { slope: 2, capQ4: 20_000, warmupBps: 1000, warmupFloorSecs: 1800n },
              settlementGraceSecs: 6n * HOUR,
              minBackingUsdc: 5_000_000n,
            },
          }),
        ]);
        log('init_config', sig);
        // stay paused until the registry has been written and read back
        log('set_paused(true)', await send([await client.setPaused(authority.publicKey, true)]));
      }
      for (const p of plan) {
        const existing = await client.program.account.assetEntry.fetchNullable(
          client.asset(p.mint),
        );
        if (existing && existing.status === 0) {
          log('asset already registered', p.symbol);
          continue;
        }
        const pol = policy(p.symbol);
        const sig = await send([
          await client.setAsset(authority.publicKey, p.mint, p.tokenProgram, {
            assetClass: pol.assetClass,
            feedId: feedIdFromHex(p.feed),
            toleranceSecs: pol.toleranceSecs,
            maxClosedStalenessSecs: pol.maxClosedStalenessSecs,
            maxConfBps: pol.maxConfBps,
            status: 0,
          }),
        ]);
        log('set_asset', p.symbol, sig);
      }
      // read everything back
      const cfgBack = await client.fetchConfig();
      log(
        'config read-back:',
        JSON.stringify({
          authority: cfgBack.authority.toBase58(),
          usdc: cfgBack.usdcMint.toBase58(),
          treasury: cfgBack.treasury.toBase58(),
          paused: cfgBack.paused,
          feeBps: cfgBack.feePolicy.feeBps,
        }),
      );
      for (const p of plan) {
        const e = await client.program.account.assetEntry.fetch(client.asset(p.mint));
        log(
          'asset read-back:',
          p.symbol,
          JSON.stringify({
            mint: e.mint.toBase58(),
            feed: Buffer.from(e.feedId as number[]).toString('hex'),
            tol: Number(e.toleranceSecs),
            conf: e.maxConfBps,
            status: e.status,
          }),
        );
        expect(Buffer.from(e.feedId as number[]).toString('hex')).toBe(p.feed);
      }
      const canary = process.env['MAINNET_CANARY'];
      if (canary || process.env['MAINNET_UNPAUSE'] === '1') {
        if (cfgBack.paused) {
          log(
            'set_paused(false)',
            await send([await client.setPaused(authority.publicKey, false)]),
          );
        }
      }
      if (canary) {
        const [sa, sb] = canary.split(',').map((s) => s.trim());
        const A = plan.find((p) => p.symbol === sa);
        const B = plan.find((p) => p.symbol === sb);
        if (!A || !B) throw new Error('canary assets must be in the allowlist');
        const now = Math.floor(Date.now() / 1000);
        const startTs = BigInt(now + Number(process.env['MAINNET_CANARY_START_IN_SECS'] ?? '300'));
        const endTs =
          startTs + BigInt(process.env['MAINNET_CANARY_DURATION_SECS'] ?? String(2 * 3600));
        const cfgNow = await client.fetchConfig();
        const { arena, instruction } = await client.createArena(
          authority.publicKey,
          A.mint,
          B.mint,
          cfgNow.usdcMint,
          {
            nonce: BigInt(now),
            startTs,
            endTs,
            allowClosedSettlement: false,
            sponsorOpen: true,
            firstParty: true,
          },
        );
        const sig = await send([instruction]);
        log(
          'canary arena',
          arena.toBase58(),
          sig,
          'starts',
          new Date(Number(startTs) * 1000).toISOString(),
          'ends',
          new Date(Number(endTs) * 1000).toISOString(),
        );
      }
    },
  );
});

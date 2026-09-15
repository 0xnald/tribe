/**
 * Devnet demo setup (real transactions; env-gated).
 *
 *   DEVNET_SETUP=1 DEVNET_AUTHORITY_KEYPAIR=~/tribe-keys/devnet-deployer.json \
 *     pnpm --filter @tribe/program-client exec vitest run --config vitest.program.config.ts tests/devnet-setup.test.ts
 *
 * 1. creates two devnet test mints that stand in for BONK (5 dp) and SOL
 *    (9 dp), registers them on the devnet program with the *real* Pyth
 *    BONK/USD and SOL/USD feed ids (Pyth publishes sponsored devnet feeds
 *    for both), mints supply to the authority;
 * 2. creates a 24 h Arena that opens shortly after;
 * 3. waits for start and runs snapshot_start against the devnet feeds.
 *
 * Prints the JSON for NEXT_PUBLIC_DEVNET_ASSETS. Idempotent per run: every
 * run creates a fresh Arena (nonce = unix time); mints are reused when
 * DEVNET_TBONK / DEVNET_TSOL are set.
 */
import { readFileSync } from 'node:fs';

import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { describe, it } from 'vitest';

import { TRIBE_ARENA_PROGRAM_ID, TribeClient, readonlyProvider, feedIdFromHex } from '../src';

const RPC = process.env['DEVNET_RPC'] ?? 'https://api.devnet.solana.com';
const PUSH_ORACLE = new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT');
const FEEDS = {
  BONK: '72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419',
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
};

function feedAccount(hex: string): PublicKey {
  const shard = Buffer.alloc(2);
  shard.writeUInt16LE(0);
  return PublicKey.findProgramAddressSync([shard, Buffer.from(hex, 'hex')], PUSH_ORACLE)[0];
}

async function main(): Promise<void> {
  const connection = new Connection(RPC, 'confirmed');
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(readFileSync(process.env['DEVNET_AUTHORITY_KEYPAIR']!, 'utf8')) as number[],
    ),
  );
  const client = new TribeClient(readonlyProvider(connection), TRIBE_ARENA_PROGRAM_ID);
  const send = async (ixs: TransactionInstruction[], signers: Keypair[] = []): Promise<string> =>
    sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [authority, ...signers], {
      commitment: 'confirmed',
    });
  const log = (...a: unknown[]) => console.log('[devnet-setup]', ...a);

  // 1. mints
  const rent = await getMinimumBalanceForRentExemptMint(connection);
  const ensureMint = async (envKey: string, decimals: number): Promise<PublicKey> => {
    const existing = process.env[envKey];
    if (existing) return new PublicKey(existing);
    const kp = Keypair.generate();
    await send(
      [
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: kp.publicKey,
          space: MINT_SIZE,
          lamports: rent,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(kp.publicKey, decimals, authority.publicKey, null),
      ],
      [kp],
    );
    log('created mint', envKey, kp.publicKey.toBase58());
    return kp.publicKey;
  };
  const tBONK = await ensureMint('DEVNET_TBONK', 5);
  const tSOL = await ensureMint('DEVNET_TSOL', 9);

  // register + mint supply to the authority
  for (const [mint, feed, label] of [
    [tBONK, FEEDS.BONK, 'tBONK'],
    [tSOL, FEEDS.SOL, 'tSOL'],
  ] as const) {
    const ata = getAssociatedTokenAddressSync(mint, authority.publicKey);
    const decimals = label === 'tBONK' ? 5 : 9;
    const sig = await send([
      await client.setAsset(authority.publicKey, mint, TOKEN_PROGRAM_ID, {
        assetClass: 0,
        feedId: feedIdFromHex(feed),
        toleranceSecs: 600n,
        maxClosedStalenessSecs: 0n,
        maxConfBps: 500,
        status: 0,
      }),
      createAssociatedTokenAccountIdempotentInstruction(
        authority.publicKey,
        ata,
        authority.publicKey,
        mint,
      ),
      createMintToInstruction(
        mint,
        ata,
        authority.publicKey,
        BigInt(label === 'tBONK' ? 1_000_000_000 : 100_000) * 10n ** BigInt(decimals),
      ),
    ]);
    log('registered', label, mint.toBase58(), sig);
  }

  // 2. arena
  const cfg = await client.fetchConfig();
  const now = Math.floor(Date.now() / 1000);
  const startTs = BigInt(now + 150);
  const endTs = startTs + 24n * 3600n;
  const nonce = BigInt(now);
  const { arena, instruction } = await client.createArena(
    authority.publicKey,
    tBONK,
    tSOL,
    cfg.usdcMint,
    {
      nonce,
      startTs,
      endTs,
      allowClosedSettlement: false,
      sponsorOpen: true,
      firstParty: true,
    },
  );
  const created = await send([instruction]);
  log(
    'arena',
    arena.toBase58(),
    'created',
    created,
    'starts',
    new Date(Number(startTs) * 1000).toISOString(),
  );

  // 3. snapshot_start once the clock passes start (devnet feeds update every ~2 min)
  const wait = Number(startTs) + 20 - Math.floor(Date.now() / 1000);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait * 1000));
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const a = await client.fetchArena(arena);
      const sig = await send([
        await client.snapshotStart(
          authority.publicKey,
          arena,
          a,
          feedAccount(FEEDS.BONK),
          feedAccount(FEEDS.SOL),
        ),
      ]);
      log('snapshot_start', sig);
      break;
    } catch (e) {
      log('snapshot_start attempt', attempt, (e as Error).message.slice(0, 160));
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  const live = await client.fetchArena(arena);
  log(
    'status',
    live.status,
    'startPrices',
    live.startPrices.map((p) => p.priceQ10.toString()),
  );
  log(
    'NEXT_PUBLIC_DEVNET_ASSETS=' +
      JSON.stringify({
        [tBONK.toBase58()]: { standsFor: 'BONK', label: 'tBONK' },
        [tSOL.toBase58()]: { standsFor: 'SOL', label: 'tSOL' },
      }),
  );
}

describe.skipIf(!process.env['DEVNET_SETUP'])('devnet setup', () => {
  it(
    'creates test mints, registers them and opens a live devnet Arena',
    { timeout: 900_000 },
    main,
  );
});

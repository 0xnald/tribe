/**
 * Post-deploy smoke test against the real devnet program.
 *
 *   DEVNET_AUTHORITY_KEYPAIR=~/tribe-keys/devnet-deployer.json \
 *     node --experimental-strip-types scripts/devnet-smoke.ts
 *
 * Read-only checks always run (program account executable, owner, IDL
 * decodes). With the authority keypair the script also sends real
 * transactions: init_config (once), set_paused(true), set_paused(false),
 * and verifies each write by reading the account back. The keypair path is
 * read from the environment and never printed.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
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

import { TRIBE_ARENA_PROGRAM_ID, TribeClient, readonlyProvider } from '../src';

const RPC = process.env['DEVNET_RPC'] ?? 'https://api.devnet.solana.com';
const BPF_UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
/** Circle USDC on devnet. */
const DEVNET_USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

const HOUR = 3600n;
const DAY = 24n * HOUR;

function ok(label: string, cond: boolean, detail = ''): void {
  expect(cond, `${label} ${detail}`).toBe(true);
  console.log(`ok   ${label} ${detail}`);
}

async function main(): Promise<void> {
  const connection = new Connection(RPC, 'confirmed');
  const client = new TribeClient(readonlyProvider(connection), TRIBE_ARENA_PROGRAM_ID);

  // 1. program account
  const info = await connection.getAccountInfo(TRIBE_ARENA_PROGRAM_ID);
  ok('program account exists', info !== null);
  ok('program is executable', info!.executable);
  ok('owned by the upgradeable loader', info!.owner.equals(BPF_UPGRADEABLE_LOADER));
  console.log(`     program id ${TRIBE_ARENA_PROGRAM_ID.toBase58()}`);

  const keypairPath = process.env['DEVNET_AUTHORITY_KEYPAIR'];
  if (!keypairPath) {
    console.log('no DEVNET_AUTHORITY_KEYPAIR: read-only checks only');
    const cfg = await client.program.account.protocolConfig.fetchNullable(client.config());
    console.log(
      cfg
        ? `     config present, authority ${cfg.authority.toBase58()}`
        : '     config not initialised',
    );
    return;
  }
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8')) as number[]),
  );
  const send = async (ixs: TransactionInstruction[]): Promise<string> => {
    const tx = new Transaction().add(...ixs);
    return sendAndConfirmTransaction(connection, tx, [authority], { commitment: 'confirmed' });
  };

  // 2. init_config once
  let cfg = await client.program.account.protocolConfig.fetchNullable(client.config());
  if (!cfg) {
    const treasury = getAssociatedTokenAddressSync(DEVNET_USDC, authority.publicKey);
    const sig = await send([
      createAssociatedTokenAccountIdempotentInstruction(
        authority.publicKey,
        treasury,
        authority.publicKey,
        DEVNET_USDC,
      ),
      await client.initConfig(authority.publicKey, DEVNET_USDC, treasury, {
        feePolicy: {
          feeBps: 50,
          rewardPoolBps: 4000,
          protocolBps: 4000,
          creatorBps: 2000,
          firstPartyCreatorTarget: 2,
        },
        limits: {
          minDurationSecs: HOUR,
          maxDurationSecs: 30n * DAY,
          minLeadSecs: 60n,
          claimWindowSecs: 30n * DAY,
          maxExtensionSecs: DAY,
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
    console.log(`     init_config ${sig}`);
    cfg = await client.program.account.protocolConfig.fetch(client.config());
  } else {
    console.log('     config already initialised');
  }
  ok('config authority is the deployer', cfg.authority.equals(authority.publicKey));
  ok('config usdc mint', cfg.usdcMint.equals(DEVNET_USDC));
  ok(
    'fee policy 50 bps 40/40/20',
    cfg.feePolicy.feeBps === 50 && cfg.feePolicy.creatorBps === 2000,
  );
  ok(
    'upset reserve is the config ATA',
    cfg.upsetReserve.equals(
      getAssociatedTokenAddressSync(DEVNET_USDC, client.config(), true, TOKEN_PROGRAM_ID),
    ),
  );

  // 3. pause round-trip (authority-gated write + read-back)
  const s1 = await send([await client.setPaused(authority.publicKey, true)]);
  cfg = await client.program.account.protocolConfig.fetch(client.config());
  ok('set_paused(true) applied', cfg.paused, s1);
  const s2 = await send([await client.setPaused(authority.publicKey, false)]);
  cfg = await client.program.account.protocolConfig.fetch(client.config());
  ok('set_paused(false) applied', !cfg.paused, s2);
  console.log('SMOKE OK');
}

describe.skipIf(!process.env['DEVNET_SMOKE'])('devnet smoke', () => {
  it('program is live and the authority path works', { timeout: 180_000 }, main);
});

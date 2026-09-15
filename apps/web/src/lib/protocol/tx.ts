import 'server-only';

import { TribeClient, readonlyProvider } from '@tribe/program-client';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Connection, PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';

import { getNetworkConfig } from '../config/network';

/**
 * Transaction builders for the protocol cluster. Instructions come from
 * @tribe/program-client; the fee is computed exactly like the program does
 * (notional at the Arena's start price × fee_bps) so the on-chain
 * `fee_paid >= required` check passes with the reference price.
 */
export async function buildBackTransaction(
  ownerStr: string,
  arenaStr: string,
  side: 'a' | 'b',
  unitsUi: number,
): Promise<{ tx: string; feeUsdc: number; units: string }> {
  const cfg = getNetworkConfig();
  const connection = new Connection(cfg.protocol.rpcUrl, 'confirmed');
  const client = new TribeClient(
    readonlyProvider(connection),
    new PublicKey(cfg.protocol.programId),
  );
  const owner = new PublicKey(ownerStr);
  const arenaPk = new PublicKey(arenaStr);
  const [arena, config] = await Promise.all([client.fetchArena(arenaPk), client.fetchConfig()]);
  const idx = side === 'a' ? 0 : 1;
  const asset = arena.assets[idx];
  const startPrice = arena.startPrices[idx];
  if (!asset || !startPrice) throw new Error('arena has no such side');
  const units = BigInt(Math.floor(unitsUi * 10 ** asset.decimals));
  if (units <= 0n) throw new Error('units too small');
  // notional (micro-USDC) = units × price_q10 / 10^(decimals + 4), then fee = notional × bps / 10_000
  const priceQ10 = BigInt(startPrice.priceQ10.toString());
  const notional = (units * priceQ10) / 10n ** BigInt(asset.decimals + 4);
  const fee = (notional * BigInt(arena.feePolicy.feeBps)) / 10_000n;
  const ixs = await client.openAndBack(owner, arenaPk, arena, config, idx as 0 | 1, units, fee);
  // The creator's USDC ATA receives the creator fee share; if the creator never made one,
  // create it (idempotent, payer = backer) so `back` cannot fail on a missing account.
  const pre: TransactionInstruction[] = [];
  if (fee > 0n && arena.creatorTarget === 0) {
    const creatorAta = getAssociatedTokenAddressSync(config.usdcMint, arena.creator, true);
    const exists = await connection.getAccountInfo(creatorAta);
    if (!exists) {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          owner,
          creatorAta,
          arena.creator,
          config.usdcMint,
        ),
      );
    }
  }
  const tx = new Transaction().add(...pre, ...ixs);
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    tx: Buffer.from(serialized).toString('base64'),
    feeUsdc: Number(fee) / 1e6,
    units: units.toString(),
  };
}

async function setup(ownerStr: string, arenaStr: string) {
  const cfg = getNetworkConfig();
  const connection = new Connection(cfg.protocol.rpcUrl, 'confirmed');
  const client = new TribeClient(
    readonlyProvider(connection),
    new PublicKey(cfg.protocol.programId),
  );
  const owner = new PublicKey(ownerStr);
  const arenaPk = new PublicKey(arenaStr);
  const [arena, config] = await Promise.all([client.fetchArena(arenaPk), client.fetchConfig()]);
  return { connection, client, owner, arenaPk, arena, config };
}

async function finish(
  connection: Connection,
  owner: PublicKey,
  ixs: Awaited<ReturnType<TribeClient['exit']>>[],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString('base64');
}

/** `exit` all (or `unitsUi`) units of the owner's position on `side`. */
export async function buildExitTransaction(
  ownerStr: string,
  arenaStr: string,
  side: 'a' | 'b',
  unitsUi?: number,
): Promise<{ tx: string }> {
  const { connection, client, owner, arenaPk, arena } = await setup(ownerStr, arenaStr);
  const idx = side === 'a' ? 0 : 1;
  const asset = arena.assets[idx];
  if (!asset) throw new Error('arena has no such side');
  let units: bigint;
  if (unitsUi !== undefined) units = BigInt(Math.floor(unitsUi * 10 ** asset.decimals));
  else {
    const pos = await client.fetchPosition(arenaPk, idx as 0 | 1, owner);
    if (!pos) throw new Error('no position');
    units = BigInt(pos.units.toString());
  }
  if (units <= 0n) throw new Error('nothing to withdraw');
  const ix = await client.exit(owner, arenaPk, arena, idx as 0 | 1, units);
  return { tx: await finish(connection, owner, [ix]) };
}

/** `claim` Arena Rewards for a settled Arena. */
export async function buildClaimTransaction(
  ownerStr: string,
  arenaStr: string,
  side: 'a' | 'b',
): Promise<{ tx: string }> {
  const { connection, client, owner, arenaPk, arena, config } = await setup(ownerStr, arenaStr);
  const idx = side === 'a' ? 0 : 1;
  const ix = await client.claim(owner, arenaPk, arena, config, idx as 0 | 1);
  return { tx: await finish(connection, owner, [ix]) };
}

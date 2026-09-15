import 'server-only';

import { TribeClient, readonlyProvider } from '@tribe/program-client';
import {
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';

import { getNetworkConfig } from '../config/network';

/**
 * Transaction builders for the protocol cluster. Instructions come from
 * @tribe/program-client; the fee is computed exactly like the program does
 * (notional at the Arena's start price × fee_bps) so the on-chain
 * `fee_paid >= required` check passes with the reference price.
 *
 * Native SOL: the program only moves SPL tokens, so a SOL side is backed as
 * wrapped SOL. The builder creates the owner's wSOL ATA when missing, moves
 * the missing lamports into it and runs `syncNative` — all in the same
 * transaction, all visible in the preview (`wrap`). Exit can append a
 * `closeAccount` so the wSOL comes back as SOL (`unwrap`).
 */
export interface WrapInfo {
  /** Lamports moved from the wallet into the wSOL ATA by this transaction. */
  lamports: string;
  ata: string;
}

export interface BackBuild {
  tx: string;
  feeUsdc: number;
  units: string;
  /** Present when the side asset is native SOL and lamports are wrapped in this transaction. */
  wrap?: WrapInfo;
}

function isNative(mint: PublicKey): boolean {
  return mint.equals(NATIVE_MINT);
}

export async function buildBackTransaction(
  ownerStr: string,
  arenaStr: string,
  side: 'a' | 'b',
  unitsUi: number,
): Promise<BackBuild> {
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

  const pre: TransactionInstruction[] = [];
  let wrap: WrapInfo | undefined;

  // Native SOL side: wrap exactly the shortfall into the owner's wSOL ATA.
  if (isNative(asset.mint)) {
    const ata = getAssociatedTokenAddressSync(NATIVE_MINT, owner, false, asset.tokenProgram);
    const acct = await connection.getAccountInfo(ata);
    let held = 0n;
    if (acct) {
      const bal = await connection.getTokenAccountBalance(ata).catch(() => null);
      held = bal ? BigInt(bal.value.amount) : 0n;
    } else {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          owner,
          ata,
          owner,
          NATIVE_MINT,
          asset.tokenProgram,
        ),
      );
    }
    const shortfall = units > held ? units - held : 0n;
    if (shortfall > 0n) {
      pre.push(
        SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports: shortfall }),
        createSyncNativeInstruction(ata, asset.tokenProgram),
      );
    }
    wrap = { lamports: shortfall.toString(), ata: ata.toBase58() };
  }

  // The creator's USDC ATA receives the creator fee share; if the creator never made one,
  // create it (idempotent, payer = backer) so `back` cannot fail on a missing account.
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
  const out: BackBuild = {
    tx: Buffer.from(serialized).toString('base64'),
    feeUsdc: Number(fee) / 1e6,
    units: units.toString(),
  };
  if (wrap) out.wrap = wrap;
  return out;
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
  ixs: TransactionInstruction[],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString('base64');
}

export interface ExitBuild {
  tx: string;
  units: string;
  /** True when the exit closes the owner's wSOL account so the asset returns as SOL. */
  unwrap: boolean;
}

/**
 * `exit` all (or `unitsUi`) units of the owner's position on `side`. For a
 * native-SOL side the destination must be the owner's wSOL ATA (created if
 * missing); with `unwrap` the ATA is closed afterwards, returning *all* of
 * its wSOL as SOL — stated explicitly in the UI.
 */
export async function buildExitTransaction(
  ownerStr: string,
  arenaStr: string,
  side: 'a' | 'b',
  unitsUi?: number,
  unwrap = false,
): Promise<ExitBuild> {
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
  const ixs: TransactionInstruction[] = [];
  const native = isNative(asset.mint);
  const ata = getAssociatedTokenAddressSync(asset.mint, owner, false, asset.tokenProgram);
  if (!(await connection.getAccountInfo(ata))) {
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        ata,
        owner,
        asset.mint,
        asset.tokenProgram,
      ),
    );
  }
  ixs.push(await client.exit(owner, arenaPk, arena, idx as 0 | 1, units));
  const doUnwrap = native && unwrap;
  if (doUnwrap) ixs.push(createCloseAccountInstruction(ata, owner, owner, [], asset.tokenProgram));
  return { tx: await finish(connection, owner, ixs), units: units.toString(), unwrap: doUnwrap };
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

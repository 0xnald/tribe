import {
  AnchorProvider,
  BN,
  Program,
  type Idl,
  type Provider,
  type Wallet,
} from '@anchor-lang/core';
import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TRIBE_ARENA_PROGRAM_ID,
  arenaPda,
  assetPda,
  ata,
  configPda,
  positionPda,
  sponsorPda,
  type Side,
} from './pda';
import type { TribeArena } from './idl/tribe_arena';
import IDL_JSON from './idl/tribe_arena.json' with { type: 'json' };

/**
 * Typed helpers for the tribe_arena program. Every method returns
 * `TransactionInstruction`s (never sends), so the web client can compose
 * `[fee legs][Jupiter swap][back]` or the two-transaction fallback itself.
 */

export type ArenaAccount = Awaited<ReturnType<Program<TribeArena>['account']['arena']['fetch']>>;
export type PositionAccount = Awaited<
  ReturnType<Program<TribeArena>['account']['position']['fetch']>
>;
export type ConfigAccount = Awaited<
  ReturnType<Program<TribeArena>['account']['protocolConfig']['fetch']>
>;
export type AssetAccount = Awaited<
  ReturnType<Program<TribeArena>['account']['assetEntry']['fetch']>
>;
export type SponsorAccount = Awaited<
  ReturnType<Program<TribeArena>['account']['sponsor']['fetch']>
>;

export const TRIBE_ARENA_IDL = IDL_JSON as unknown as TribeArena;

export interface FeePolicyArgs {
  feeBps: number;
  rewardPoolBps: number;
  protocolBps: number;
  creatorBps: number;
  firstPartyCreatorTarget: number;
}
export interface UnderdogPolicyArgs {
  slope: number;
  capQ4: number;
  warmupBps: number;
  warmupFloorSecs: bigint;
}
export interface ArenaParamsArgs {
  tieBps: number;
  minHoldBps: number;
  minHoldFloorSecs: bigint;
  underdog: UnderdogPolicyArgs;
  settlementGraceSecs: bigint;
  minBackingUsdc: bigint;
}
export interface ProtocolLimitsArgs {
  minDurationSecs: bigint;
  maxDurationSecs: bigint;
  minLeadSecs: bigint;
  claimWindowSecs: bigint;
  maxExtensionSecs: bigint;
  reserveDrawBps: number;
  upsetBonusCapUsdc: bigint;
}
export interface InitConfigArgs {
  feePolicy: FeePolicyArgs;
  limits: ProtocolLimitsArgs;
  defaultParams: ArenaParamsArgs;
}
export interface SetAssetArgs {
  assetClass: number; // 0 Crypto, 1 Equity, 2 Etf, 3 Commodity
  feedId: Uint8Array; // 32 bytes
  toleranceSecs: bigint;
  maxClosedStalenessSecs: bigint;
  maxConfBps: number;
  status: number; // 0 Active, 1 Suspended, 2 Retired
}
export interface CreateArenaArgs {
  nonce: bigint;
  startTs: bigint;
  endTs: bigint;
  allowClosedSettlement: boolean;
  sponsorOpen: boolean;
  firstParty: boolean;
}

const bn = (x: bigint): BN => new BN(x.toString());

function sideAsset(a: ArenaAccount, side: Side): ArenaAccount['assets'][number] {
  const asset = a.assets[side];
  if (!asset) throw new Error(`arena has no side ${side}`);
  return asset;
}

/** Read-only provider for building instructions without a signer. */
export function readonlyProvider(connection: Connection): Provider {
  const kp = Keypair.generate();
  const wallet: Wallet = {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: () => Promise.reject(new Error('readonly')),
    signAllTransactions: () => Promise.reject(new Error('readonly')),
  } as unknown as Wallet;
  return new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
}

export class TribeClient {
  readonly program: Program<TribeArena>;
  readonly programId: PublicKey;

  constructor(provider: Provider, programId: PublicKey = TRIBE_ARENA_PROGRAM_ID) {
    const idl = { ...(TRIBE_ARENA_IDL as unknown as Idl), address: programId.toBase58() };
    this.program = new Program(idl as unknown as TribeArena, provider);
    this.programId = programId;
  }

  // ─── PDAs
  config(): PublicKey {
    return configPda(this.programId)[0];
  }
  asset(mint: PublicKey): PublicKey {
    return assetPda(mint, this.programId)[0];
  }
  arena(creator: PublicKey, nonce: bigint): PublicKey {
    return arenaPda(creator, nonce, this.programId)[0];
  }
  position(arena: PublicKey, side: Side, owner: PublicKey): PublicKey {
    return positionPda(arena, side, owner, this.programId)[0];
  }
  sponsor(arena: PublicKey, sponsor: PublicKey): PublicKey {
    return sponsorPda(arena, sponsor, this.programId)[0];
  }

  // ─── fetchers
  fetchConfig(): Promise<ConfigAccount> {
    return this.program.account.protocolConfig.fetch(this.config());
  }
  fetchAsset(mint: PublicKey): Promise<AssetAccount> {
    return this.program.account.assetEntry.fetch(this.asset(mint));
  }
  fetchArena(arena: PublicKey): Promise<ArenaAccount> {
    return this.program.account.arena.fetch(arena);
  }
  fetchPosition(arena: PublicKey, side: Side, owner: PublicKey): Promise<PositionAccount | null> {
    return this.program.account.position.fetchNullable(this.position(arena, side, owner));
  }
  fetchSponsor(arena: PublicKey, sponsor: PublicKey): Promise<SponsorAccount | null> {
    return this.program.account.sponsor.fetchNullable(this.sponsor(arena, sponsor));
  }

  // ─── protocol admin
  async initConfig(
    authority: PublicKey,
    usdcMint: PublicKey,
    treasury: PublicKey,
    args: InitConfigArgs,
    usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    const config = this.config();
    return this.program.methods
      .initConfig({
        feePolicy: args.feePolicy,
        limits: {
          minDurationSecs: bn(args.limits.minDurationSecs),
          maxDurationSecs: bn(args.limits.maxDurationSecs),
          minLeadSecs: bn(args.limits.minLeadSecs),
          claimWindowSecs: bn(args.limits.claimWindowSecs),
          maxExtensionSecs: bn(args.limits.maxExtensionSecs),
          reserveDrawBps: args.limits.reserveDrawBps,
          upsetBonusCapUsdc: bn(args.limits.upsetBonusCapUsdc),
        },
        defaultParams: {
          tieBps: args.defaultParams.tieBps,
          minHoldBps: args.defaultParams.minHoldBps,
          minHoldFloorSecs: bn(args.defaultParams.minHoldFloorSecs),
          underdog: {
            slope: args.defaultParams.underdog.slope,
            capQ4: args.defaultParams.underdog.capQ4,
            warmupBps: args.defaultParams.underdog.warmupBps,
            warmupFloorSecs: bn(args.defaultParams.underdog.warmupFloorSecs),
          },
          settlementGraceSecs: bn(args.defaultParams.settlementGraceSecs),
          minBackingUsdc: bn(args.defaultParams.minBackingUsdc),
        },
      })
      .accountsStrict({
        authority,
        config,
        usdcMint,
        treasury,
        upsetReserve: ata(config, usdcMint, usdcTokenProgram),
        usdcTokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: PublicKey.default,
      })
      .instruction();
  }

  async setAsset(
    authority: PublicKey,
    mint: PublicKey,
    tokenProgram: PublicKey,
    args: SetAssetArgs,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .setAsset({
        assetClass: args.assetClass,
        feedId: Array.from(args.feedId),
        toleranceSecs: bn(args.toleranceSecs),
        maxClosedStalenessSecs: bn(args.maxClosedStalenessSecs),
        maxConfBps: args.maxConfBps,
        status: args.status,
      })
      .accountsStrict({
        authority,
        config: this.config(),
        asset: this.asset(mint),
        mint,
        tokenProgram,
        systemProgram: PublicKey.default,
      })
      .instruction();
  }

  async setPaused(authority: PublicKey, paused: boolean): Promise<TransactionInstruction> {
    return this.program.methods
      .setPaused(paused)
      .accountsStrict({ authority, config: this.config() })
      .instruction();
  }

  // ─── arena lifecycle
  async createArena(
    creator: PublicKey,
    mintA: PublicKey,
    mintB: PublicKey,
    usdcMint: PublicKey,
    args: CreateArenaArgs,
    usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<{ arena: PublicKey; rewardVault: PublicKey; instruction: TransactionInstruction }> {
    const arena = this.arena(creator, args.nonce);
    const rewardVault = ata(arena, usdcMint, usdcTokenProgram);
    const instruction = await this.program.methods
      .createArena({
        nonce: bn(args.nonce),
        startTs: bn(args.startTs),
        endTs: bn(args.endTs),
        allowClosedSettlement: args.allowClosedSettlement,
        sponsorOpen: args.sponsorOpen,
        firstParty: args.firstParty,
      })
      .accountsStrict({
        creator,
        config: this.config(),
        assetA: this.asset(mintA),
        assetB: this.asset(mintB),
        arena,
        usdcMint,
        rewardVault,
        usdcTokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: PublicKey.default,
      })
      .instruction();
    return { arena, rewardVault, instruction };
  }

  async fundRewardPool(
    sponsor: PublicKey,
    arena: PublicKey,
    a: ArenaAccount,
    usdcMint: PublicKey,
    amount: bigint,
    usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .fundRewardPool(bn(amount))
      .accountsStrict({
        sponsor,
        config: this.config(),
        arena,
        sponsorRecord: this.sponsor(arena, sponsor),
        usdcMint,
        sponsorUsdc: ata(sponsor, usdcMint, usdcTokenProgram),
        rewardVault: a.rewardVault,
        usdcTokenProgram,
        systemProgram: PublicKey.default,
      })
      .instruction();
  }

  async snapshotStart(
    cranker: PublicKey,
    arena: PublicKey,
    a: ArenaAccount,
    priceUpdateA: PublicKey,
    priceUpdateB: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .snapshotStart()
      .accountsStrict({
        cranker,
        arena,
        priceUpdateA,
        priceUpdateB,
        mintA: sideAsset(a, 0).mint,
        mintB: sideAsset(a, 1).mint,
      })
      .instruction();
  }

  /** Idempotently create the Position PDA and its vault ATA for `side`. */
  async openPosition(
    owner: PublicKey,
    arena: PublicKey,
    a: ArenaAccount,
    side: Side,
  ): Promise<TransactionInstruction> {
    const asset = sideAsset(a, side);
    const position = this.position(arena, side, owner);
    return this.program.methods
      .openPosition(side)
      .accountsStrict({
        owner,
        arena,
        position,
        assetMint: asset.mint,
        positionVault: ata(position, asset.mint, asset.tokenProgram),
        assetTokenProgram: asset.tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: PublicKey.default,
      })
      .instruction();
  }

  /**
   * Back `side` with units already in the owner's token account. Requires the
   * position to exist (`openPosition`, composable in the same transaction).
   * For a USDC entry, prepend the Jupiter swap instructions that deliver the
   * asset into `ownerAsset` (see `composeSwapAndBack`).
   */
  async back(
    owner: PublicKey,
    arena: PublicKey,
    a: ArenaAccount,
    cfg: ConfigAccount,
    side: Side,
    units: bigint,
    feePaid: bigint,
    usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    const asset = sideAsset(a, side);
    const position = this.position(arena, side, owner);
    const creatorUsdc =
      a.creatorTarget === 0 ? ata(a.creator, cfg.usdcMint, usdcTokenProgram) : null;
    return this.program.methods
      .back(side, bn(units), bn(feePaid))
      .accountsStrict({
        owner,
        config: this.config(),
        arena,
        position,
        assetMint: asset.mint,
        ownerAsset: ata(owner, asset.mint, asset.tokenProgram),
        positionVault: ata(position, asset.mint, asset.tokenProgram),
        assetTokenProgram: asset.tokenProgram,
        usdcMint: cfg.usdcMint,
        ownerUsdc: ata(owner, cfg.usdcMint, usdcTokenProgram),
        rewardVault: a.rewardVault,
        treasury: cfg.treasury,
        creatorUsdc,
        usdcTokenProgram,
      })
      .instruction();
  }

  /** `[openPosition][back]` for a first entry on a side. */
  async openAndBack(...args: Parameters<TribeClient['back']>): Promise<TransactionInstruction[]> {
    const [owner, arena, a, , side] = args;
    return [await this.openPosition(owner, arena, a, side), await this.back(...args)];
  }

  /**
   * Swap-then-back composition: the caller supplies Jupiter `swap/v2/build`
   * instructions (setup/swap/cleanup) that leave the asset in the owner's ATA;
   * the `back` instruction is appended. `units` must be the minimum output the
   * route guarantees (`otherAmountThreshold`) — the program verifies the vault
   * delta, so never pass the optimistic quote. If the combined transaction
   * exceeds 1232 bytes, send the swap first and `back` in a second tx.
   */
  async composeSwapAndBack(
    swapInstructions: TransactionInstruction[],
    backArgs: Parameters<TribeClient['back']>,
  ): Promise<TransactionInstruction[]> {
    const back = await this.back(...backArgs);
    return [...swapInstructions, back];
  }

  async exit(
    owner: PublicKey,
    arena: PublicKey,
    a: ArenaAccount,
    side: Side,
    units: bigint,
  ): Promise<TransactionInstruction> {
    const asset = sideAsset(a, side);
    const position = this.position(arena, side, owner);
    return this.program.methods
      .exit(bn(units))
      .accountsStrict({
        owner,
        arena,
        position,
        assetMint: asset.mint,
        positionVault: ata(position, asset.mint, asset.tokenProgram),
        ownerAsset: ata(owner, asset.mint, asset.tokenProgram),
        assetTokenProgram: asset.tokenProgram,
      })
      .instruction();
  }

  async settle(
    cranker: PublicKey,
    arena: PublicKey,
    a: ArenaAccount,
    cfg: ConfigAccount,
    priceUpdateA: PublicKey,
    priceUpdateB: PublicKey,
    usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .settle()
      .accountsStrict({
        cranker,
        config: this.config(),
        arena,
        priceUpdateA,
        priceUpdateB,
        mintA: sideAsset(a, 0).mint,
        mintB: sideAsset(a, 1).mint,
        usdcMint: cfg.usdcMint,
        upsetReserve: cfg.upsetReserve,
        rewardVault: a.rewardVault,
        usdcTokenProgram,
      })
      .instruction();
  }

  async claim(
    owner: PublicKey,
    arena: PublicKey,
    a: ArenaAccount,
    cfg: ConfigAccount,
    side: Side,
    usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .claim()
      .accountsStrict({
        owner,
        config: this.config(),
        arena,
        position: this.position(arena, side, owner),
        usdcMint: cfg.usdcMint,
        rewardVault: a.rewardVault,
        ownerUsdc: ata(owner, cfg.usdcMint, usdcTokenProgram),
        usdcTokenProgram,
      })
      .instruction();
  }

  async cancelArena(
    authority: PublicKey,
    arena: PublicKey,
    reasonCode: number,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .cancelArena(reasonCode)
      .accountsStrict({ authority, config: this.config(), arena })
      .instruction();
  }

  async cancelExpired(cranker: PublicKey, arena: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods.cancelExpired().accountsStrict({ cranker, arena }).instruction();
  }

  async extendSettlement(
    authority: PublicKey,
    arena: PublicKey,
    secs: bigint,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .extendSettlement(bn(secs))
      .accountsStrict({ authority, config: this.config(), arena })
      .instruction();
  }

  async refundSponsor(
    sponsor: PublicKey,
    arena: PublicKey,
    a: ArenaAccount,
    cfg: ConfigAccount,
    usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .refundSponsor()
      .accountsStrict({
        sponsor,
        config: this.config(),
        arena,
        sponsorRecord: this.sponsor(arena, sponsor),
        usdcMint: cfg.usdcMint,
        sponsorUsdc: ata(sponsor, cfg.usdcMint, usdcTokenProgram),
        rewardVault: a.rewardVault,
        usdcTokenProgram,
      })
      .instruction();
  }

  async sweepUnclaimed(
    cranker: PublicKey,
    arena: PublicKey,
    a: ArenaAccount,
    cfg: ConfigAccount,
    usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .sweepUnclaimed()
      .accountsStrict({
        cranker,
        config: this.config(),
        arena,
        usdcMint: cfg.usdcMint,
        rewardVault: a.rewardVault,
        treasury: cfg.treasury,
        usdcTokenProgram,
      })
      .instruction();
  }
}

/**
 * Bankrun (solana-program-test) harness for tribe_arena program tests.
 *
 * Why an in-process SVM (not solana-test-validator): Pyth `PriceUpdateV2`
 * accounts are produced by the receiver program from Wormhole-verified VAAs
 * and cannot be fabricated on a validator, and Arena windows are hours long.
 * Bankrun lets tests write arbitrary receiver-owned accounts and set the
 * clock, so the exact production validation path (owner check,
 * discriminator, verification level, feed id, publish-time windows) runs
 * unchanged.
 *
 * Bankrun bundles an old Token-2022 (no ScaledUiAmount / Pausable). The
 * mainnet Token-2022 binary is loaded from `tests/fixtures` instead
 * (see fixtures/README.md), so xStocks-like mints behave as in production.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ExtensionType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createInitializePausableConfigInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeScaledUiAmountConfigInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  unpackAccount,
} from '@solana/spl-token';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Signer,
} from '@solana/web3.js';
import {
  type AccountInfoBytes,
  type BanksClient,
  Clock,
  type ProgramTestContext,
  start,
} from 'solana-bankrun';

import { PYTH_RECEIVER_PROGRAM_ID, encodePriceUpdateV2, type PriceUpdateV2Fields } from '../src';

const PROGRAM_DIR = join(import.meta.dirname, '..', '..', '..', 'programs', 'tribe_arena');
export const PROGRAM_DEPLOY_DIR = join(PROGRAM_DIR, 'target', 'deploy');
export const PROGRAM_SO = join(PROGRAM_DEPLOY_DIR, 'tribe_arena.so');
export const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

export function loadIdl(): unknown {
  return JSON.parse(
    readFileSync(join(PROGRAM_DIR, 'target', 'idl', 'tribe_arena.json'), 'utf8'),
  ) as unknown;
}

export interface Svm {
  ctx: ProgramTestContext;
  client: BanksClient;
  payer: Keypair;
  programId: PublicKey;
  /** Thin view used by tests. */
  svm: {
    getAccount(address: PublicKey): Promise<AccountInfoBytes | null>;
    getClock(): Promise<Clock>;
    setAccount(address: PublicKey, info: AccountInfoBytes): void;
  };
}

export async function createSvm(programId: PublicKey): Promise<Svm> {
  if (!existsSync(PROGRAM_SO)) {
    throw new Error(`missing ${PROGRAM_SO}: build with 'cargo build-sbf --arch v0' first`);
  }
  const token2022 = join(FIXTURES_DIR, 'spl_token_2022.so');
  if (!existsSync(token2022)) {
    throw new Error(`missing ${token2022}: see tests/fixtures/README.md`);
  }
  // Bankrun resolves program files from BPF_OUT_DIR and ./tests/fixtures.
  process.env['BPF_OUT_DIR'] = PROGRAM_DEPLOY_DIR;
  process.env['SBF_OUT_DIR'] = PROGRAM_DEPLOY_DIR;
  const ctx = await start(
    [
      { name: 'tribe_arena', programId },
      { name: 'spl_token_2022', programId: TOKEN_2022_PROGRAM_ID },
    ],
    [],
  );
  const client = ctx.banksClient;
  return {
    ctx,
    client,
    payer: ctx.payer,
    programId,
    svm: {
      getAccount: (a) => client.getAccount(a),
      getClock: () => client.getClock(),
      setAccount: (a, info) => ctx.setAccount(a, info),
    },
  };
}

export async function airdrop(h: Svm, to: PublicKey, lamports = 100_000_000_000n): Promise<void> {
  const existing = await h.client.getAccount(to);
  if (existing) {
    h.ctx.setAccount(to, { ...existing, lamports: existing.lamports + Number(lamports) });
    return;
  }
  h.ctx.setAccount(to, {
    lamports: Number(lamports),
    data: new Uint8Array(0),
    owner: SystemProgram.programId,
    executable: false,
  });
}

export async function nowTs(h: Svm): Promise<bigint> {
  return (await h.client.getClock()).unixTimestamp;
}

/** Advance one slot so the next transaction lands in a fresh bank. */
async function tick(h: Svm): Promise<void> {
  const slot = await h.client.getSlot();
  h.ctx.warpToSlot(slot + 1n);
}

/**
 * Set the clock. Timestamps must be in the future relative to the genesis
 * estimate (bankrun re-derives the clock on each warp and keeps the max), so
 * tests use a far-future epoch and only ever move forward.
 */
export async function setClock(h: Svm, unixTimestamp: bigint): Promise<void> {
  const c = await h.client.getClock();
  if (unixTimestamp < c.unixTimestamp) {
    throw new Error(`setClock backwards: ${unixTimestamp} < ${c.unixTimestamp}`);
  }
  h.ctx.setClock(
    new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unixTimestamp),
  );
}

export class TxError extends Error {
  constructor(
    readonly result: string,
    readonly logs: string[],
  ) {
    super(`tx failed: ${result}\n${logs.join('\n')}`);
  }
  /** Anchor error name (e.g. `BackingClosed`) if present in logs. */
  get anchorError(): string | undefined {
    for (const l of this.logs) {
      const m = /Error Code: ([A-Za-z0-9]+)\./.exec(l);
      if (m) return m[1];
      if (l.includes('already in use')) return 'AccountAlreadyInUse';
    }
    return undefined;
  }
}

export async function send(
  h: Svm,
  ixs: TransactionInstruction[],
  signers: Signer[],
): Promise<string[]> {
  const tx = new Transaction();
  const bh = await h.client.getLatestBlockhash();
  if (!bh) throw new Error('no blockhash');
  tx.recentBlockhash = bh[0];
  tx.feePayer = signers[0]?.publicKey ?? h.payer.publicKey;
  tx.add(...ixs);
  tx.sign(...signers);
  const r = await h.client.tryProcessTransaction(tx);
  const logs = r.meta?.logMessages ?? [];
  // Tick after every attempt (failed ones are in the status cache too) so a
  // byte-identical retry is not rejected as a duplicate.
  await tick(h);
  if (r.result !== null) {
    throw new TxError(r.result, logs);
  }
  return logs;
}

/** Expect a transaction to fail with the given Anchor error name. */
export async function expectError(fn: () => unknown, name: string): Promise<TxError> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof TxError) {
      if (e.anchorError !== name) {
        const got = e.anchorError ?? 'unknown';
        throw new Error(['expected ' + name + ', got ' + got, ...e.logs].join('\n'));
      }
      return e;
    }
    throw e;
  }
  throw new Error(`expected ${name} but transaction succeeded`);
}

export interface MintOpts {
  program?: PublicKey;
  decimals?: number;
  scaledUi?: number; // multiplier
  pausable?: boolean;
  permanentDelegate?: PublicKey;
  transferFeeBps?: number;
  transferHook?: PublicKey | null; // null = extension with no program
}

/** Create a mint; Token-2022 extensions per opts (xStocks-like when scaledUi/pausable/permanentDelegate set). */
export async function createMint(
  h: Svm,
  authority: Keypair,
  opts: MintOpts = {},
): Promise<{ mint: PublicKey; program: PublicKey; decimals: number }> {
  const program = opts.program ?? TOKEN_PROGRAM_ID;
  const decimals = opts.decimals ?? 6;
  const mint = Keypair.generate();
  const exts: ExtensionType[] = [];
  if (program.equals(TOKEN_2022_PROGRAM_ID)) {
    if (opts.scaledUi !== undefined) exts.push(ExtensionType.ScaledUiAmountConfig);
    if (opts.pausable) exts.push(ExtensionType.PausableConfig);
    if (opts.permanentDelegate) exts.push(ExtensionType.PermanentDelegate);
    if (opts.transferFeeBps !== undefined) exts.push(ExtensionType.TransferFeeConfig);
    if (opts.transferHook !== undefined) exts.push(ExtensionType.TransferHook);
  }
  const len = program.equals(TOKEN_2022_PROGRAM_ID) ? getMintLen(exts) : MINT_SIZE;
  const rent = await h.client.getRent();
  const ixs: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mint.publicKey,
      space: len,
      lamports: Number(rent.minimumBalance(BigInt(len))),
      programId: program,
    }),
  ];
  if (program.equals(TOKEN_2022_PROGRAM_ID)) {
    if (opts.scaledUi !== undefined) {
      ixs.push(
        createInitializeScaledUiAmountConfigInstruction(
          mint.publicKey,
          authority.publicKey,
          opts.scaledUi,
          program,
        ),
      );
    }
    if (opts.pausable)
      ixs.push(
        createInitializePausableConfigInstruction(mint.publicKey, authority.publicKey, program),
      );
    if (opts.permanentDelegate)
      ixs.push(
        createInitializePermanentDelegateInstruction(
          mint.publicKey,
          opts.permanentDelegate,
          program,
        ),
      );
    if (opts.transferFeeBps !== undefined) {
      ixs.push(
        createInitializeTransferFeeConfigInstruction(
          mint.publicKey,
          authority.publicKey,
          authority.publicKey,
          opts.transferFeeBps,
          1_000_000_000n,
          program,
        ),
      );
    }
    if (opts.transferHook !== undefined) {
      ixs.push(
        createInitializeTransferHookInstruction(
          mint.publicKey,
          authority.publicKey,
          opts.transferHook ?? PublicKey.default,
          program,
        ),
      );
    }
  }
  ixs.push(
    createInitializeMint2Instruction(mint.publicKey, decimals, authority.publicKey, null, program),
  );
  await send(h, ixs, [authority, mint]);
  return { mint: mint.publicKey, program, decimals };
}

export async function createAta(
  h: Svm,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
  program: PublicKey,
): Promise<PublicKey> {
  const addr = getAssociatedTokenAddressSync(mint, owner, true, program);
  await send(
    h,
    [
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        addr,
        owner,
        mint,
        program,
      ),
    ],
    [payer],
  );
  return addr;
}

export async function mintTo(
  h: Svm,
  authority: Keypair,
  mint: PublicKey,
  to: PublicKey,
  amount: bigint,
  program: PublicKey,
): Promise<void> {
  await send(
    h,
    [createMintToInstruction(mint, to, authority.publicKey, amount, [], program)],
    [authority],
  );
}

export async function tokenBalance(h: Svm, account: PublicKey): Promise<bigint> {
  const info = await h.client.getAccount(account);
  if (!info) return 0n;
  const acc = unpackAccount(
    account,
    { ...info, owner: new PublicKey(info.owner), data: Buffer.from(info.data) } as never,
    new PublicKey(info.owner),
  );
  return acc.amount;
}

/** Write a receiver-owned PriceUpdateV2 fixture. */
export function setPriceUpdate(h: Svm, address: PublicKey, fields: PriceUpdateV2Fields): void {
  const data = encodePriceUpdateV2(fields);
  h.ctx.setAccount(address, {
    lamports: 10_000_000,
    data,
    owner: PYTH_RECEIVER_PROGRAM_ID,
    executable: false,
  });
}

export function priceUpdateFixture(
  feedIdHex: string,
  priceQ10: bigint,
  publishTime: bigint,
  extra: Partial<PriceUpdateV2Fields> = {},
): PriceUpdateV2Fields {
  const feedId = Uint8Array.from(Buffer.from(feedIdHex, 'hex'));
  return {
    writeAuthority: PublicKey.default,
    verificationLevel: 'Full',
    feedId,
    price: priceQ10,
    conf: 0n,
    exponent: -10,
    publishTime,
    prevPublishTime: publishTime - 1n,
    emaPrice: priceQ10,
    emaConf: 0n,
    postedSlot: 1n,
    ...extra,
  };
}

/**
 * LiteSVM harness for tribe_arena program tests.
 *
 * Why LiteSVM (not solana-test-validator): Pyth `PriceUpdateV2` accounts are
 * produced by the receiver program from Wormhole-verified VAAs and cannot be
 * fabricated on a validator, and Arena windows are hours long. LiteSVM lets
 * tests set arbitrary receiver-owned accounts and the clock, so the exact
 * production validation path (owner check, discriminator, verification
 * level, feed id, publish-time windows) runs unchanged.
 */
import { readFileSync } from 'node:fs';
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
import { Clock, FailedTransactionMetadata, LiteSVM, TransactionMetadata } from 'litesvm';

import { PYTH_RECEIVER_PROGRAM_ID, encodePriceUpdateV2, type PriceUpdateV2Fields } from '../src';

export const PROGRAM_SO = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'programs',
  'tribe_arena',
  'target',
  'deploy',
  'tribe_arena.so',
);

export function loadIdl(): unknown {
  return JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'programs',
        'tribe_arena',
        'target',
        'idl',
        'tribe_arena.json',
      ),
      'utf8',
    ),
  ) as unknown;
}

export interface Svm {
  svm: LiteSVM;
  payer: Keypair;
  programId: PublicKey;
}

export function createSvm(programId: PublicKey): Svm {
  const svm = new LiteSVM()
    .withSysvars()
    .withBuiltins()
    .withDefaultPrograms()
    .withSigverify(true)
    .withBlockhashCheck(false);
  svm.addProgramFromFile(programId, PROGRAM_SO);
  const payer = Keypair.generate();
  svm.airdrop(payer.publicKey, 1_000_000_000_000n);
  return { svm, payer, programId };
}

export function airdrop(h: Svm, to: PublicKey, lamports = 100_000_000_000n): void {
  h.svm.airdrop(to, lamports);
}

export function nowTs(h: Svm): bigint {
  return h.svm.getClock().unixTimestamp;
}

export function setClock(h: Svm, unixTimestamp: bigint): void {
  const c = h.svm.getClock();
  const clock = new Clock(
    c.slot + 1n,
    c.epochStartTimestamp,
    c.epoch,
    c.leaderScheduleEpoch,
    unixTimestamp,
  );
  h.svm.setClock(clock);
  h.svm.expireBlockhash();
}

export class TxError extends Error {
  constructor(
    readonly meta: FailedTransactionMetadata,
    readonly logs: string[],
  ) {
    super(`tx failed: ${meta.err().toString()}\n${logs.join('\n')}`);
  }
  /** Anchor error name (e.g. `BackingClosed`) if present in logs. */
  get anchorError(): string | undefined {
    for (const l of this.logs) {
      const m = /Error Code: ([A-Za-z0-9]+)\./.exec(l);
      if (m) return m[1];
    }
    return undefined;
  }
}

export function send(
  h: Svm,
  ixs: TransactionInstruction[],
  signers: Signer[],
): TransactionMetadata {
  const tx = new Transaction();
  tx.recentBlockhash = h.svm.latestBlockhash();
  tx.feePayer = signers[0]?.publicKey ?? h.payer.publicKey;
  tx.add(...ixs);
  tx.sign(...signers);
  const r = h.svm.sendTransaction(tx);
  if (r instanceof FailedTransactionMetadata) {
    throw new TxError(r, r.meta().logs());
  }
  h.svm.expireBlockhash();
  return r;
}

/** Expect a transaction to fail with the given Anchor error name. */
export function expectError(fn: () => unknown, name: string): TxError {
  try {
    fn();
  } catch (e) {
    if (e instanceof TxError) {
      if (e.anchorError !== name) {
        throw new Error(
          `expected ${name}, got ${e.anchorError ?? 'unknown'}\n${e.logs.join('\n')}`,
        );
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
export function createMint(
  h: Svm,
  authority: Keypair,
  opts: MintOpts = {},
): { mint: PublicKey; program: PublicKey; decimals: number } {
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
  const ixs: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mint.publicKey,
      space: len,
      lamports: Number(h.svm.minimumBalanceForRentExemption(BigInt(len))),
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
  send(h, ixs, [authority, mint]);
  return { mint: mint.publicKey, program, decimals };
}

export function createAta(
  h: Svm,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
  program: PublicKey,
): PublicKey {
  const addr = getAssociatedTokenAddressSync(mint, owner, true, program);
  send(
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

export function mintTo(
  h: Svm,
  authority: Keypair,
  mint: PublicKey,
  to: PublicKey,
  amount: bigint,
  program: PublicKey,
): void {
  send(
    h,
    [createMintToInstruction(mint, to, authority.publicKey, amount, [], program)],
    [authority],
  );
}

export function tokenBalance(h: Svm, account: PublicKey): bigint {
  const info = h.svm.getAccount(account);
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
  h.svm.setAccount(address, {
    lamports: 10_000_000,
    data,
    owner: PYTH_RECEIVER_PROGRAM_ID,
    executable: false,
    rentEpoch: 0,
  });
}

export function priceUpdateFixture(
  feedIdHex: string,
  priceQ8: bigint,
  publishTime: bigint,
  extra: Partial<PriceUpdateV2Fields> = {},
): PriceUpdateV2Fields {
  const feedId = Uint8Array.from(Buffer.from(feedIdHex, 'hex'));
  return {
    writeAuthority: PublicKey.default,
    verificationLevel: 'Full',
    feedId,
    price: priceQ8,
    conf: 0n,
    exponent: -8,
    publishTime,
    prevPublishTime: publishTime - 1n,
    emaPrice: priceQ8,
    emaConf: 0n,
    postedSlot: 1n,
    ...extra,
  };
}

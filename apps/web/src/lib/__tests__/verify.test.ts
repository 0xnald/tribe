import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { verifyTribeTransaction } from '../protocol/verify';

const PROGRAM = 'shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4';
const owner = Keypair.generate().publicKey;
const arena = Keypair.generate().publicKey;
const want = { programId: PROGRAM, arena: arena.toBase58(), owner: owner.toBase58() };

function tribeIx(keys: PublicKey[]): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(PROGRAM),
    keys: keys.map((k) => ({ pubkey: k, isSigner: false, isWritable: true })),
    data: Buffer.from([1]),
  });
}

function tx(...ixs: TransactionInstruction[]): Transaction {
  const t = new Transaction().add(...ixs);
  t.feePayer = owner;
  t.recentBlockhash = '11111111111111111111111111111111';
  return t;
}

describe('verifyTribeTransaction', () => {
  it('accepts a Tribe instruction for the expected Arena and owner', () => {
    expect(() => verifyTribeTransaction(tx(tribeIx([owner, arena])), want)).not.toThrow();
  });
  it('rejects a different Arena', () => {
    const other = Keypair.generate().publicKey;
    expect(() => verifyTribeTransaction(tx(tribeIx([owner, other])), want)).toThrow(
      /different Arena/,
    );
  });
  it('rejects unknown programs and raw transfers', () => {
    const rogue = new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [],
      data: Buffer.alloc(0),
    });
    expect(() => verifyTribeTransaction(tx(tribeIx([owner, arena]), rogue), want)).toThrow(
      /unexpected program/,
    );
    const sys = SystemProgram.transfer({ fromPubkey: owner, toPubkey: arena, lamports: 1 });
    expect(() => verifyTribeTransaction(tx(tribeIx([owner, arena]), sys), want)).toThrow(
      /system instruction/,
    );
  });
  it('rejects a foreign fee payer and an empty transaction', () => {
    const t = tx(tribeIx([owner, arena]));
    t.feePayer = Keypair.generate().publicKey;
    expect(() => verifyTribeTransaction(t, want)).toThrow(/fee payer/);
    const ata = new TransactionInstruction({
      programId: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
      keys: [],
      data: Buffer.alloc(0),
    });
    expect(() => verifyTribeTransaction(tx(ata), want)).toThrow(/no Tribe instruction/);
  });
});

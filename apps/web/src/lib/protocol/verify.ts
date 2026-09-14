import { PublicKey, type Transaction } from '@solana/web3.js';

/**
 * Client-side intent check before a wallet signs a server-built transaction.
 * The server is trusted code, but this closes the "sign whatever came back"
 * gap: every instruction must target a known program, every Tribe
 * instruction must reference the Arena the user is looking at, and the fee
 * payer must be the connected wallet.
 */
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM = '11111111111111111111111111111111';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';

export interface IntentCheck {
  programId: string;
  arena: string;
  owner: string;
}

export function verifyTribeTransaction(tx: Transaction, want: IntentCheck): void {
  if (!tx.feePayer || tx.feePayer.toBase58() !== want.owner) {
    throw new Error('transaction fee payer is not your wallet');
  }
  const allowed = new Set([
    want.programId,
    ATA_PROGRAM,
    TOKEN_PROGRAM,
    TOKEN_2022,
    SYSTEM,
    COMPUTE_BUDGET,
  ]);
  let tribeIxs = 0;
  for (const ix of tx.instructions) {
    const pid = ix.programId.toBase58();
    if (!allowed.has(pid)) throw new Error(`unexpected program in transaction: ${pid}`);
    if (pid === want.programId) {
      tribeIxs += 1;
      const keys = ix.keys.map((k) => k.pubkey.toBase58());
      if (!keys.includes(want.arena)) throw new Error('transaction targets a different Arena');
      if (!keys.includes(want.owner)) throw new Error('transaction does not involve your wallet');
    }
    // the only non-Tribe instructions we accept are ATA creation and compute budget
    if (pid === TOKEN_PROGRAM || pid === TOKEN_2022) {
      throw new Error('unexpected direct token instruction');
    }
    if (pid === SYSTEM) throw new Error('unexpected system instruction');
  }
  if (tribeIxs === 0) throw new Error('no Tribe instruction in transaction');
  // signatures already present (other than the placeholder for the owner) would mean a co-signer we did not expect
  for (const s of tx.signatures) {
    if (s.signature && !s.publicKey.equals(new PublicKey(want.owner))) {
      throw new Error('transaction carries an unexpected signature');
    }
  }
}

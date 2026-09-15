import {
  PublicKey,
  SystemInstruction,
  type Transaction,
  type VersionedTransaction,
} from '@solana/web3.js';

/**
 * Client-side intent checks before a wallet signs a server-built (or
 * Jupiter-built) transaction. The server is trusted code, but this closes the
 * "sign whatever came back" gap: every instruction must target a known
 * program, every Tribe instruction must reference the Arena the user is
 * looking at, the fee payer must be the connected wallet, and the only
 * non-Tribe instructions accepted are the exact ATA-creation / SOL-wrapping
 * steps the preview describes.
 */
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM = '11111111111111111111111111111111';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
/** Jupiter aggregator v6 (mainnet). */
export const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

const TOKEN_IX_SYNC_NATIVE = 17;
const TOKEN_IX_CLOSE_ACCOUNT = 9;

export interface IntentCheck {
  programId: string;
  arena: string;
  owner: string;
  /**
   * When the side asset is native SOL: the owner's wSOL ATA. Allows a
   * System transfer owner → ATA, a `syncNative` on it, and (exit) a
   * `closeAccount` of it back to the owner. Nothing else.
   */
  wsolAta?: string | undefined;
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
      continue;
    }
    if (pid === SYSTEM) {
      // only "wrap SOL": a transfer from the owner to the owner's own wSOL ATA
      if (!want.wsolAta || SystemInstruction.decodeInstructionType(ix) !== 'Transfer') {
        throw new Error('unexpected system instruction');
      }
      const t = SystemInstruction.decodeTransfer(ix);
      if (t.fromPubkey.toBase58() !== want.owner || t.toPubkey.toBase58() !== want.wsolAta) {
        throw new Error('unexpected SOL transfer');
      }
      continue;
    }
    if (pid === TOKEN_PROGRAM || pid === TOKEN_2022) {
      const op = ix.data[0];
      const first = ix.keys[0]?.pubkey.toBase58();
      if (want.wsolAta && op === TOKEN_IX_SYNC_NATIVE && first === want.wsolAta) continue;
      if (want.wsolAta && op === TOKEN_IX_CLOSE_ACCOUNT && first === want.wsolAta) {
        const dest = ix.keys[1]?.pubkey.toBase58();
        const auth = ix.keys[2]?.pubkey.toBase58();
        if (dest === want.owner && auth === want.owner) continue;
      }
      throw new Error('unexpected direct token instruction');
    }
    // ATA creation and compute budget are accepted as-is
  }
  if (tribeIxs === 0) throw new Error('no Tribe instruction in transaction');
  // signatures already present (other than the placeholder for the owner) would mean a co-signer we did not expect
  for (const s of tx.signatures) {
    if (s.signature && !s.publicKey.equals(new PublicKey(want.owner))) {
      throw new Error('transaction carries an unexpected signature');
    }
  }
}

export interface SwapIntent {
  owner: string;
  /** Programs Jupiter may route through. Lookup-table-resolved programs are checked by the caller via `extraPrograms`. */
  extraPrograms?: string[] | undefined;
}

/**
 * Intent check for a Jupiter-built swap (VersionedTransaction). The fee
 * payer must be the wallet, every statically addressed program must be
 * Jupiter, a token/ATA/system/compute program, and no other signer may be
 * required. Programs addressed through lookup tables are resolved by the
 * caller (they need an RPC) and passed in `extraPrograms`.
 */
export function verifyJupiterSwap(tx: VersionedTransaction, want: SwapIntent): void {
  const msg = tx.message;
  const keys = msg.staticAccountKeys;
  const payer = keys[0];
  if (!payer || payer.toBase58() !== want.owner) {
    throw new Error('swap fee payer is not your wallet');
  }
  if (msg.header.numRequiredSignatures !== 1) {
    throw new Error('swap requires an unexpected co-signer');
  }
  const allowed = new Set([
    JUPITER_V6,
    ATA_PROGRAM,
    TOKEN_PROGRAM,
    TOKEN_2022,
    SYSTEM,
    COMPUTE_BUDGET,
    ...(want.extraPrograms ?? []),
  ]);
  for (const ix of msg.compiledInstructions) {
    const pid = keys[ix.programIdIndex];
    if (!pid) continue; // addressed through a lookup table → caller-resolved
    if (!allowed.has(pid.toBase58())) {
      throw new Error(`unexpected program in swap: ${pid.toBase58()}`);
    }
  }
}

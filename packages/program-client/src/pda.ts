import { PublicKey } from '@solana/web3.js';

/** Default program id (placeholder until deployment; override via `TribeClient`). */
export const TRIBE_ARENA_PROGRAM_ID = new PublicKey('shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4');

/** Pyth Solana receiver program (owner of `PriceUpdateV2` accounts). */
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey(
  'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ',
);

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

const enc = new TextEncoder();

export type Side = 0 | 1;

export function configPda(programId = TRIBE_ARENA_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc.encode('config')], programId);
}

export function assetPda(mint: PublicKey, programId = TRIBE_ARENA_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([enc.encode('asset'), mint.toBuffer()], programId);
}

export function arenaPda(
  creator: PublicKey,
  nonce: bigint,
  programId = TRIBE_ARENA_PROGRAM_ID,
): [PublicKey, number] {
  const n = Buffer.alloc(8);
  n.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync([enc.encode('arena'), creator.toBuffer(), n], programId);
}

export function positionPda(
  arena: PublicKey,
  side: Side,
  owner: PublicKey,
  programId = TRIBE_ARENA_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc.encode('position'), arena.toBuffer(), Buffer.from([side]), owner.toBuffer()],
    programId,
  );
}

export function sponsorPda(
  arena: PublicKey,
  sponsor: PublicKey,
  programId = TRIBE_ARENA_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [enc.encode('sponsor'), arena.toBuffer(), sponsor.toBuffer()],
    programId,
  );
}

/** Associated token address for either token program. */
export function ata(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  const [addr] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return addr;
}

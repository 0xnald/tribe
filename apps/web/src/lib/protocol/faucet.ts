import 'server-only';

import { readFileSync } from 'node:fs';

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

import { getNetworkConfig } from '../config/network';
import { DEVNET_ASSETS } from './devnet-assets';

/**
 * Devnet test-token faucet. Mints the stand-in tokens (tBONK, tSOL) to a
 * wallet so anyone can try a real devnet Back. Only works when the server
 * holds the mint authority (DEVNET_FAUCET_KEYPAIR: JSON secret key or a
 * file path) and the protocol cluster is devnet. Never on mainnet.
 */
const AMOUNTS: Record<string, bigint> = { BONK: 50_000_000n, SOL: 50n };
const DECIMALS: Record<string, number> = { BONK: 5, SOL: 9 };

function authority(): Keypair | null {
  const raw = process.env['DEVNET_FAUCET_KEYPAIR'];
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith('[') ? raw : readFileSync(raw, 'utf8');
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json) as number[]));
  } catch {
    return null;
  }
}

export function faucetAvailable(): boolean {
  return getNetworkConfig().protocol.cluster === 'devnet' && authority() !== null;
}

export async function dripDevnetTokens(
  ownerStr: string,
): Promise<{ signature: string; minted: Array<{ mint: string; label: string; amount: string }> }> {
  const cfg = getNetworkConfig();
  if (cfg.protocol.cluster !== 'devnet') throw new Error('faucet is devnet-only');
  const auth = authority();
  if (!auth) throw new Error('faucet not configured');
  const owner = new PublicKey(ownerStr);
  const connection = new Connection(cfg.protocol.rpcUrl, 'confirmed');
  const tx = new Transaction();
  const minted: Array<{ mint: string; label: string; amount: string }> = [];
  for (const [mint, alias] of Object.entries(DEVNET_ASSETS)) {
    const amount = AMOUNTS[alias.standsFor];
    const decimals = DECIMALS[alias.standsFor];
    if (amount === undefined || decimals === undefined) continue;
    const m = new PublicKey(mint);
    const ata = getAssociatedTokenAddressSync(m, owner);
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(auth.publicKey, ata, owner, m),
      createMintToInstruction(m, ata, auth.publicKey, amount * 10n ** BigInt(decimals)),
    );
    minted.push({ mint, label: alias.label, amount: amount.toString() });
  }
  if (minted.length === 0) throw new Error('no devnet assets configured');
  const signature = await sendAndConfirmTransaction(connection, tx, [auth], {
    commitment: 'confirmed',
  });
  return { signature, minted };
}

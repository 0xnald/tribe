/**
 * Crank runner. Usage:
 *   CRANK_RPC_URL=... CRANK_KEYPAIR=<json array | path> [TRIBE_PROGRAM_ID=...] [CRANK_INTERVAL_SECS=30] [CRANK_DRY_RUN=1] [CRANK_ONCE=1]
 *   node dist/crank.cjs
 */
import { readFileSync } from 'node:fs';

import { Keypair, PublicKey } from '@solana/web3.js';

import { crankOnce } from '../src/crank';
import { TRIBE_ARENA_PROGRAM_ID } from '../src/pda';

function signer(): Keypair {
  const raw = process.env['CRANK_KEYPAIR'];
  if (!raw) throw new Error('CRANK_KEYPAIR is required (JSON secret key or file path)');
  const json = raw.trim().startsWith('[') ? raw : readFileSync(raw, 'utf8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json) as number[]));
}

async function main(): Promise<void> {
  const rpcUrl = process.env['CRANK_RPC_URL'] ?? 'https://api.devnet.solana.com';
  const programId = new PublicKey(
    process.env['TRIBE_PROGRAM_ID'] ?? TRIBE_ARENA_PROGRAM_ID.toBase58(),
  );
  const dryRun = process.env['CRANK_DRY_RUN'] === '1';
  const once = process.env['CRANK_ONCE'] === '1';
  const interval = Number(process.env['CRANK_INTERVAL_SECS'] ?? '30') * 1000;
  const kp = dryRun && !process.env['CRANK_KEYPAIR'] ? Keypair.generate() : signer();
  console.log(
    `[crank] rpc=${rpcUrl} program=${programId.toBase58()} signer=${kp.publicKey.toBase58()} dryRun=${dryRun}`,
  );
  for (;;) {
    const started = Date.now();
    try {
      const r = await crankOnce({ rpcUrl, programId, signer: kp, dryRun });
      console.log(
        `[crank] pass done: ${r.actions.length} arenas, ${r.signatures.length} sent, ${r.errors.length} errors`,
      );
    } catch (e) {
      console.error('[crank] pass failed:', e instanceof Error ? e.message : e);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, Math.max(1000, interval - (Date.now() - started))));
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

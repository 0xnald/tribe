'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { WalletControl } from '@/components/layout/WalletControl';
import type { ArenaView, SideKey } from '@/lib/arena/model';
import { sideOf } from '@/lib/arena/model';
import { clearPendingBack, setPendingBack, type PendingBack } from '@/lib/back/pending';
import type { BackPreview } from '@/lib/back/preview';
import { explorerTxUrl, getNetworkConfig } from '@/lib/config/network';
import { fmtAmount, fmtUsd } from '@/lib/format';
import type { PositionRecord } from '@/lib/positions/model';
import { verifyJupiterSwap, verifyTribeTransaction } from '@/lib/protocol/verify';
import { nowSecs } from '@/lib/time';

import { Button } from '../ui/Button';

/**
 * Two transactions, never presented as one:
 *   1. Buy <asset> — Jupiter swap USDC → asset into the wallet (mainnet)
 *   2. Back <asset> — Tribe `open_position + back` with the units actually received
 *
 * The units for step 2 are the on-chain balance delta measured after step 1
 * confirms, never the quote. If step 2 is cancelled or fails, the asset
 * stays in the wallet, a pending record is kept and "Retry Back" re-runs
 * only step 2. A second buy is impossible while a pending record exists.
 */
type Phase =
  | 'idle'
  | 'buy:preparing'
  | 'buy:awaiting'
  | 'buy:submitted'
  | 'buy:confirmed'
  | 'back:preparing'
  | 'back:awaiting'
  | 'back:submitted'
  | 'done'
  | 'failed';

interface SwapBuild {
  swapTransaction: string;
  lastValidBlockHeight: number;
  quote: {
    outAmount: string;
    otherAmountThreshold: string;
    routeLabel: string;
    slippageBps: number;
  };
}

export function TwoStepBack({
  arena,
  side,
  preview,
  pending,
  onDone,
}: {
  arena: ArenaView;
  side: SideKey;
  preview: BackPreview;
  /** A buy that already confirmed earlier (from storage) — start at step 2. */
  pending: PendingBack | null;
  onDone: (record: PositionRecord, sig: string) => void;
}) {
  const wallet = useWallet();
  const cfg = getNetworkConfig();
  const s = sideOf(arena, side);
  const [phase, setPhase] = useState<Phase>(pending ? 'buy:confirmed' : 'idle');
  const [bought, setBought] = useState<PendingBack | null>(pending);
  const [error, setError] = useState<string | null>(null);
  const [swapSig, setSwapSig] = useState<string | null>(pending?.swapSig ?? null);
  const owner = wallet.publicKey?.toBase58() ?? null;

  const marketConn = () => new Connection(cfg.market.rpcUrl, 'confirmed');
  const protocolConn = () => new Connection(cfg.protocol.rpcUrl, 'confirmed');

  async function tokenBalance(
    conn: Connection,
    ownerPk: PublicKey,
    mint: PublicKey,
  ): Promise<bigint> {
    const r = await conn.getParsedTokenAccountsByOwner(ownerPk, { mint });
    let total = 0n;
    for (const acc of r.value) {
      const info = acc.account.data as {
        parsed?: { info?: { tokenAmount?: { amount?: string } } };
      };
      total += BigInt(info.parsed?.info?.tokenAmount?.amount ?? '0');
    }
    return total;
  }

  /** Transaction 1. */
  const buy = async () => {
    if (!wallet.publicKey || !wallet.signTransaction || bought) return;
    const ownerPk = wallet.publicKey;
    const mint = new PublicKey(s.asset.marketMint ?? s.asset.mint);
    try {
      setError(null);
      setPhase('buy:preparing');
      const conn = marketConn();
      const before = await tokenBalance(conn, ownerPk, mint);
      const r = await fetch('/api/market/swap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner: ownerPk.toBase58(),
          outputMint: mint.toBase58(),
          amount: String(Math.round(preview.notionalUsd * 1e6)),
          slippageBps: 50,
        }),
      });
      const j = (await r.json()) as SwapBuild & { error?: string };
      if (!r.ok || !j.swapTransaction)
        throw new Error(j.error ?? 'Jupiter could not build the swap');
      const vtx = VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, 'base64'));
      // resolve lookup tables so programs addressed through them are checked too
      const extra: string[] = [];
      for (const l of vtx.message.addressTableLookups) {
        const t = await conn.getAddressLookupTable(l.accountKey);
        const addrs = t.value?.state.addresses ?? [];
        for (const i of [...l.writableIndexes, ...l.readonlyIndexes]) {
          const a = addrs[i];
          if (a) extra.push(a.toBase58());
        }
      }
      verifyJupiterSwap(vtx, { owner: ownerPk.toBase58(), extraPrograms: extra });
      setPhase('buy:awaiting');
      const signed = await wallet.signTransaction(vtx);
      setPhase('buy:submitted');
      const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      setSwapSig(sig);
      const bh = await conn.getLatestBlockhash();
      const c = await conn.confirmTransaction(
        { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
        'confirmed',
      );
      if (c.value.err) throw new Error('the swap failed on-chain; nothing was bought');
      const after = await tokenBalance(conn, ownerPk, mint);
      const deltaRaw = after - before;
      if (deltaRaw <= 0n)
        throw new Error('swap confirmed but no tokens arrived; check the explorer');
      const receivedUnits = Number(deltaRaw) / 10 ** s.asset.decimals;
      const rec: PendingBack = {
        arenaId: arena.id,
        side,
        mint: s.asset.mint,
        symbol: s.asset.symbol,
        receivedUnits,
        swapSig: sig,
        usdcSpent: preview.notionalUsd,
        createdAt: nowSecs(),
      };
      setPendingBack(rec);
      setBought(rec);
      setPhase('buy:confirmed');
      await back(rec);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed';
      setError(
        /reject|denied|cancel/i.test(msg)
          ? 'You dismissed the wallet prompt. Nothing was bought.'
          : msg,
      );
      setPhase('failed');
    }
  };

  /** Transaction 2 — uses only the units received in transaction 1. */
  const back = async (rec: PendingBack) => {
    if (!wallet.publicKey || !wallet.signTransaction || !arena.onchain) return;
    const ownerPk = wallet.publicKey;
    try {
      setError(null);
      setPhase('back:preparing');
      // only what actually arrived in the wallet is backed — never the quote
      const units = rec.receivedUnits;
      const r = await fetch('/api/protocol/back', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner: ownerPk.toBase58(),
          arena: arena.onchain.arena,
          side,
          units,
        }),
      });
      const j = (await r.json()) as { tx?: string; error?: string; wrap?: { ata: string } };
      if (!r.ok || !j.tx) throw new Error(j.error ?? 'could not build the Back transaction');
      const t = Transaction.from(Buffer.from(j.tx, 'base64'));
      verifyTribeTransaction(t, {
        programId: cfg.protocol.programId,
        arena: arena.onchain.arena,
        owner: ownerPk.toBase58(),
        wsolAta: j.wrap?.ata,
      });
      setPhase('back:awaiting');
      const signed = await wallet.signTransaction(t);
      setPhase('back:submitted');
      const conn = protocolConn();
      const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      const bh = await conn.getLatestBlockhash();
      const c = await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
      if (c.value.err) throw new Error('Back failed on-chain');
      clearPendingBack(arena.id, side);
      setPhase('done');
      onDone(
        {
          id: `onchain-${sig}`,
          provenance: 'onchain',
          arenaSlug: arena.slug,
          arenaId: arena.id,
          side,
          units,
          entryTs: nowSecs(),
          usdAtEntry: rec.usdcSpent,
          feeUsd: preview.feeUsd,
          multiplierAtEntry: preview.multiplier,
          status: 'active',
          txSig: sig,
        },
        sig,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed';
      setError(
        /reject|denied|cancel/i.test(msg)
          ? `You dismissed the wallet prompt. Your ${s.asset.symbol} is in your wallet — retry the Back when ready.`
          : msg,
      );
      setPhase('failed');
    }
  };

  if (!owner) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <p className="text-sm text-fg-muted">Connect a Solana wallet to buy and back.</p>
        <WalletControl />
      </div>
    );
  }

  const stepOf = (p: Phase): 1 | 2 | 3 =>
    p.startsWith('buy') && p !== 'buy:confirmed' ? 1 : p === 'done' ? 3 : 2;
  const activeStep = phase === 'idle' ? 1 : stepOf(phase);
  const busy =
    phase !== 'idle' && phase !== 'failed' && phase !== 'buy:confirmed' && phase !== 'done';
  const label = (p: Phase): string =>
    ({
      idle: '',
      'buy:preparing': 'Fetching Jupiter route',
      'buy:awaiting': 'Approve the buy in your wallet',
      'buy:submitted': 'Buying — confirming on Solana',
      'buy:confirmed': 'Bought',
      'back:preparing': 'Preparing the Back',
      'back:awaiting': 'Approve the Back in your wallet',
      'back:submitted': 'Backing — confirming on Solana',
      done: 'Done',
      failed: '',
    })[p];

  return (
    <div className="flex flex-col gap-4" aria-live="polite" data-testid="two-step">
      <p className="text-sm text-fg-muted">
        This is <strong className="text-fg">two transactions</strong>, each approved separately.
        They are not atomic: if the second does not complete, the {s.asset.symbol} you bought stays
        in your wallet.
      </p>
      <ol className="flex flex-col gap-2">
        <Row
          n={1}
          title={`Buy ${s.asset.symbol}`}
          detail={`${fmtUsd(preview.notionalUsd, { cents: true })} USDC → ${fmtAmount(preview.units, s.asset.symbol)} est. · Jupiter`}
          state={bought ? 'done' : activeStep === 1 && busy ? 'active' : 'todo'}
          sig={swapSig}
          note={
            busy && activeStep === 1
              ? label(phase)
              : bought
                ? `Received ${fmtAmount(bought.receivedUnits, s.asset.symbol)}`
                : undefined
          }
        />
        <Row
          n={2}
          title={`Back ${s.asset.symbol}`}
          detail="Tribe Position Vault · fee 0.50%"
          state={phase === 'done' ? 'done' : activeStep === 2 && busy ? 'active' : 'todo'}
          sig={null}
          note={busy && activeStep === 2 ? label(phase) : undefined}
        />
      </ol>
      {error ? (
        <div className="rounded-[12px] border border-fall/40 bg-[color-mix(in_oklab,var(--fall)_10%,transparent)] px-3 py-3 text-sm">
          <p className="font-semibold text-fall">
            {bought ? 'Back not completed' : 'Buy not completed'}
          </p>
          <p className="text-fg-muted">{error}</p>
        </div>
      ) : null}
      {phase === 'idle' || (phase === 'failed' && !bought) ? (
        <Button
          variant="asset"
          size="lg"
          className="w-full"
          onClick={() => void buy()}
          disabled={!wallet.signTransaction}
          data-testid="two-step-buy"
        >
          1. Buy {s.asset.symbol} (sign)
        </Button>
      ) : null}
      {bought && (phase === 'failed' || phase === 'buy:confirmed') ? (
        <Button
          variant="asset"
          size="lg"
          className="w-full"
          onClick={() => void back(bought)}
          data-testid="two-step-back"
        >
          2. Back {fmtAmount(bought.receivedUnits, s.asset.symbol)} (sign) — no re-buy
        </Button>
      ) : null}
      {busy ? (
        <p className="inline-flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden /> {label(phase)}
        </p>
      ) : null}
    </div>
  );
}

function Row({
  n,
  title,
  detail,
  state,
  sig,
  note,
}: {
  n: number;
  title: string;
  detail: string;
  state: 'todo' | 'active' | 'done';
  sig: string | null;
  note?: string | undefined;
}) {
  return (
    <li
      className={`flex items-start gap-3 rounded-[12px] border px-3 py-2.5 text-sm ${state === 'done' ? 'border-volt/40' : state === 'active' ? 'border-line-strong' : 'border-line opacity-80'}`}
    >
      <span
        className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${state === 'done' ? 'border-volt bg-volt text-[#0e0f12]' : 'border-line'}`}
      >
        {state === 'done' ? (
          <Check size={14} aria-hidden />
        ) : state === 'active' ? (
          <Loader2 size={12} className="animate-spin" aria-hidden />
        ) : (
          n
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-fg-muted">{detail}</span>
        {note ? <span className="text-xs text-fg">{note}</span> : null}
        {sig ? (
          <a
            href={explorerTxUrl(sig)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-devnet-fg hover:underline"
          >
            {sig.slice(0, 8)}…{sig.slice(-6)} <ExternalLink size={11} aria-hidden />
          </a>
        ) : null}
      </span>
    </li>
  );
}

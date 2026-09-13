'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { ArrowLeft, Check, ExternalLink, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { WalletControl } from '@/components/layout/WalletControl';
import { useDemoPositions } from '@/hooks/useDemoPositions';
import { useNow } from '@/hooks/useNow';
import { useTokenBalance } from '@/hooks/useTokenBalance';
import { isBackable, otherSide, sideOf, type ArenaView, type SideKey } from '@/lib/arena/model';
import { buildPreview, type BackPreview } from '@/lib/back/preview';
import { explorerTxUrl } from '@/lib/config/network';
import { fmtAmount, fmtDuration, fmtMultiplier, fmtPct, fmtPrice, fmtUsd } from '@/lib/format';
import type { PositionRecord } from '@/lib/positions/model';

import { AssetLogo } from '../arena/AssetIdentity';
import { ProvenanceBadge } from '../arena/ProvenanceBadge';
import { ShareArena } from '../arena/ShareArena';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';

type Step = 'side' | 'method' | 'amount' | 'preview' | 'confirm' | 'success';
type Method = 'usdc' | 'holdings';
type TxState = 'idle' | 'preparing' | 'awaiting' | 'submitted' | 'confirmed' | 'failed';

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const QUICK = [25, 50, 100, 250];

interface Quote {
  units: number;
  routeLabel: string;
  priceImpactPct: number;
  slippageBps: number;
}

/**
 * Back flow (DESIGN_SYSTEM §6.8): side → method → amount → preview →
 * wallet → success. Demo Arenas never send a transaction (every step says
 * so); devnet Arenas sign a real `open_position + back` transaction built
 * server-side through @tribe/program-client.
 */
export function BackSheet({
  open,
  onOpenChange,
  arena,
  side,
  session,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  arena: ArenaView;
  side: SideKey;
  /** Increments on every open so the flow remounts with clean state. */
  session: number;
}) {
  const s = sideOf(arena, side);
  const o = sideOf(arena, otherSide(side));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Back ${s.asset.symbol}`}
      description={`Back ${s.asset.symbol} in the ${s.asset.symbol} vs ${o.asset.symbol} Arena`}
      hideTitle
    >
      <BackFlow
        key={`${arena.id}:${side}:${session}`}
        arena={arena}
        side={side}
        onClose={() => onOpenChange(false)}
      />
    </Sheet>
  );
}

function BackFlow({
  arena,
  side,
  onClose,
}: {
  arena: ArenaView;
  side: SideKey;
  onClose: () => void;
}) {
  const now = useNow();
  const wallet = useWallet();
  const { connection } = useConnection();
  const demoPositions = useDemoPositions();
  const s = sideOf(arena, side);
  const o = sideOf(arena, otherSide(side));
  const isDemo = arena.provenance === 'demo';
  const isDevnet = arena.provenance === 'devnet';

  const [step, setStep] = useState<Step>('side');
  const [method, setMethod] = useState<Method>(isDevnet ? 'holdings' : 'usdc');
  const [amountStr, setAmountStr] = useState('100');
  const [quoteRes, setQuoteRes] = useState<{ key: string; value: Quote | 'unavailable' } | null>(
    null,
  );
  const [tx, setTx] = useState<{ state: TxState; sig?: string; error?: string }>({ state: 'idle' });
  const [record, setRecord] = useState<PositionRecord | null>(null);
  const [faucetTick, setFaucetTick] = useState(0);

  const owner = wallet.publicKey?.toBase58() ?? null;
  const usdcBal = useTokenBalance(
    isDevnet ? 'protocol' : 'market',
    step !== 'side' && !isDevnet ? USDC_MAINNET : null,
    owner,
  );
  const assetBal = useTokenBalance(
    isDevnet ? 'protocol' : 'market',
    step !== 'side' ? s.asset.mint : null,
    owner,
    faucetTick,
  );

  const amount = Number(amountStr) || 0;

  // indicative mainnet quote for USDC buys (demo Arenas only — the real assets live on mainnet)
  const wantQuote = method === 'usdc' && !isDevnet && step === 'amount' && amount > 0;
  const quoteKey = `${s.asset.mint}:${Math.round(amount * 1e6)}`;
  useEffect(() => {
    if (!wantQuote) return;
    let alive = true;
    const t = setTimeout(async () => {
      let value: Quote | 'unavailable' = 'unavailable';
      try {
        const r = await fetch(
          `/api/market/quote?out=${s.asset.mint}&amount=${Math.round(amount * 1e6)}`,
          { cache: 'no-store' },
        );
        const j = (await r.json()) as {
          data: {
            outAmount: string;
            routeLabel: string;
            priceImpactPct: number;
            slippageBps: number;
          } | null;
        };
        if (j.data)
          value = {
            units: Number(j.data.outAmount) / 10 ** s.asset.decimals,
            routeLabel: j.data.routeLabel,
            priceImpactPct: j.data.priceImpactPct,
            slippageBps: j.data.slippageBps,
          };
      } catch {
        value = 'unavailable';
      }
      if (alive) setQuoteRes({ key: quoteKey, value });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [wantQuote, quoteKey, amount, s.asset.mint, s.asset.decimals]);
  const quote: Quote | null | 'loading' | 'unavailable' = !wantQuote
    ? null
    : quoteRes && quoteRes.key === quoteKey
      ? quoteRes.value
      : 'loading';

  const preview: BackPreview = useMemo(
    () =>
      buildPreview({
        arena,
        side,
        method,
        amount,
        now,
        quotedUnits: typeof quote === 'object' && quote ? quote.units : undefined,
      }),
    [arena, side, method, amount, now, quote],
  );

  const backable = isBackable(arena, now);
  const closesIn = arena.backingCloseTs - now;

  // ─── confirm
  const runDemo = useCallback(async () => {
    setTx({ state: 'preparing' });
    await sleep(500);
    setTx({ state: 'awaiting' });
    await sleep(700);
    setTx({ state: 'submitted' });
    await sleep(600);
    const rec: PositionRecord = {
      id: `demo-${Date.now()}`,
      provenance: 'demo',
      arenaSlug: arena.slug,
      arenaId: arena.id,
      side,
      units: preview.units,
      entryTs: Math.floor(Date.now() / 1000),
      usdAtEntry: preview.notionalUsd,
      feeUsd: preview.feeUsd,
      multiplierAtEntry: preview.multiplier,
      status: 'active',
    };
    demoPositions.add(rec);
    setRecord(rec);
    setTx({ state: 'confirmed' });
    setStep('success');
  }, [arena.id, arena.slug, side, preview, demoPositions]);

  const runDevnet = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !arena.onchain) return;
    try {
      setTx({ state: 'preparing' });
      const r = await fetch('/api/protocol/back', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner: wallet.publicKey.toBase58(),
          arena: arena.onchain.arena,
          side,
          units: preview.units,
        }),
      });
      const j = (await r.json()) as { tx?: string; error?: string };
      if (!r.ok || !j.tx) throw new Error(j.error ?? 'could not build transaction');
      const t = Transaction.from(Buffer.from(j.tx, 'base64'));
      setTx({ state: 'awaiting' });
      const signed = await wallet.signTransaction(t);
      setTx({ state: 'submitted' });
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      const bh = await connection.getLatestBlockhash();
      const conf = await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
      if (conf.value.err) throw new Error('transaction failed on-chain');
      const rec: PositionRecord = {
        id: `devnet-${sig}`,
        provenance: 'devnet',
        arenaSlug: arena.slug,
        arenaId: arena.id,
        side,
        units: preview.units,
        entryTs: Math.floor(Date.now() / 1000),
        usdAtEntry: preview.notionalUsd,
        feeUsd: preview.feeUsd,
        multiplierAtEntry: preview.multiplier,
        status: 'active',
        txSig: sig,
      };
      setRecord(rec);
      setTx({ state: 'confirmed', sig });
      setStep('success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed';
      setTx({
        state: 'failed',
        error: /reject|denied|cancel/i.test(msg)
          ? 'You dismissed the wallet prompt. Nothing was sent.'
          : friendlyError(msg),
      });
    }
  }, [wallet, arena.onchain, arena.slug, arena.id, side, preview, connection]);

  const title = step === 'success' ? `You're backing ${s.asset.symbol}` : `Back ${s.asset.symbol}`;

  return (
    <div
      className="flex flex-col gap-5"
      style={{ ['--asset' as string]: s.asset.color }}
      data-testid="back-sheet"
      data-step={step}
    >
      {/* header */}
      <div className="flex items-center gap-3">
        {step !== 'side' && step !== 'success' ? (
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-full text-fg-muted hover:bg-[color-mix(in_oklab,var(--fg)_8%,transparent)] hover:text-fg"
            onClick={() => setStep(prev(step))}
            aria-label="Back"
          >
            <ArrowLeft size={18} strokeWidth={1.75} />
          </button>
        ) : null}
        <AssetLogo asset={s.asset} size={40} />
        <div className="flex min-w-0 flex-col">
          <h2 className="display truncate text-xl font-extrabold leading-tight">{title}</h2>
          <span className="text-xs text-fg-muted">
            {s.asset.symbol} vs {o.asset.symbol} · {stepLabel(step)}
          </span>
        </div>
        <ProvenanceBadge provenance={arena.provenance} className="ml-auto" />
      </div>

      {isDemo && step !== 'success' ? (
        <p className="rounded-[12px] border border-dashed border-line-strong px-3 py-2 text-xs text-fg-muted">
          Demo Arena — simulated prices, no transaction. The flow, fees and rules are the real ones.
        </p>
      ) : null}

      {/* steps */}
      {step === 'side' ? (
        <SideStep
          arena={arena}
          side={side}
          now={now}
          closesIn={closesIn}
          backable={backable}
          onNext={() => setStep('method')}
        />
      ) : null}
      {step === 'method' ? (
        <MethodStep
          method={method}
          setMethod={setMethod}
          isDevnet={isDevnet}
          symbol={s.asset.symbol}
          usdcBal={usdcBal}
          assetBal={assetBal}
          connected={!!owner}
          owner={owner}
          onFaucet={() => setFaucetTick((n) => n + 1)}
          onNext={() => {
            setAmountStr(method === 'usdc' ? '100' : '');
            setStep('amount');
          }}
        />
      ) : null}
      {step === 'amount' ? (
        <AmountStep
          method={method}
          symbol={s.asset.symbol}
          price={s.price}
          amountStr={amountStr}
          setAmountStr={setAmountStr}
          preview={preview}
          quote={quote}
          usdcBal={usdcBal.state === 'ok' ? usdcBal.amount : null}
          assetBal={assetBal.state === 'ok' ? assetBal.amount : null}
          isDemo={isDemo}
          onNext={() => setStep('preview')}
        />
      ) : null}
      {step === 'preview' ? (
        <PreviewStep
          preview={preview}
          arena={arena}
          side={side}
          onNext={() => setStep('confirm')}
        />
      ) : null}
      {step === 'confirm' ? (
        <ConfirmStep
          preview={preview}
          isDemo={isDemo}
          tx={tx}
          connected={!!owner}
          canSign={!!wallet.signTransaction}
          onRun={() => void (isDemo ? runDemo() : runDevnet())}
          onRetry={() => setTx({ state: 'idle' })}
        />
      ) : null}
      {step === 'success' && record ? (
        <SuccessStep arena={arena} side={side} record={record} sig={tx.sig} onClose={onClose} />
      ) : null}
    </div>
  );
}

/* ─────────────────────────── steps ─────────────────────────── */

function SideStep({
  arena,
  side,
  now,
  closesIn,
  backable,
  onNext,
}: {
  arena: ArenaView;
  side: SideKey;
  now: number;
  closesIn: number;
  backable: boolean;
  onNext: () => void;
}) {
  const s = sideOf(arena, side);
  const o = sideOf(arena, otherSide(side));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <SidePill s={s} chosen />
        <SidePill s={o} chosen={false} />
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Cell k="Arena remaining" v={fmtDuration(arena.endTs - now)} />
        <Cell
          k="Backing closes"
          v={closesIn > 0 ? `in ${fmtDuration(closesIn)}` : 'closed'}
          tone={closesIn < 3600 ? 'ember' : undefined}
        />
        <Cell
          k={`${s.asset.symbol} backing`}
          v={`${Math.round(s.backingShare * 100)}% · ${fmtUsd(s.backingUsd)}`}
        />
        <Cell
          k="Your multiplier"
          v={s.multiplier > 1.005 ? `${fmtMultiplier(s.multiplier)} underdog` : '1× (favourite)'}
          tone={s.multiplier > 1.005 ? 'gold' : undefined}
        />
      </dl>
      <p className="text-sm text-fg-muted">
        You&apos;re backing <strong className="text-fg">{s.asset.symbol}</strong> to outperform{' '}
        {o.asset.symbol} from now until the Arena ends. You own the {s.asset.symbol}; the Arena only
        decides who shares the reward pool.
      </p>
      {backable ? (
        <Button
          variant="asset"
          size="lg"
          onClick={onNext}
          className="w-full"
          data-testid="back-next"
        >
          Continue
        </Button>
      ) : (
        <p className="rounded-[12px] bg-bg-sunken px-3 py-3 text-center text-sm text-fg-muted">
          Backing is closed for this Arena.
        </p>
      )}
    </div>
  );
}

function SidePill({ s, chosen }: { s: ArenaView['sides'][number]; chosen: boolean }) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-[14px] border p-3 ${chosen ? 'asset-tint border-[color-mix(in_oklab,var(--asset)_60%,transparent)]' : 'border-line opacity-70'}`}
      style={{ ['--asset' as string]: s.asset.color }}
    >
      <span className="micro text-fg-muted">{chosen ? 'You back' : 'Against'}</span>
      <span className="display text-xl font-extrabold">{s.asset.symbol}</span>
      <span
        className={`tnum text-sm font-semibold ${s.perfPct > 0 ? 'text-rise' : s.perfPct < 0 ? 'text-fall' : 'text-fg-muted'}`}
      >
        {fmtPct(s.perfPct)} since start
      </span>
    </div>
  );
}

function MethodStep({
  method,
  setMethod,
  isDevnet,
  symbol,
  usdcBal,
  assetBal,
  connected,
  owner,
  onFaucet,
  onNext,
}: {
  method: Method;
  setMethod: (m: Method) => void;
  isDevnet: boolean;
  symbol: string;
  usdcBal: ReturnType<typeof useTokenBalance>;
  assetBal: ReturnType<typeof useTokenBalance>;
  connected: boolean;
  owner: string | null;
  onFaucet: () => void;
  onNext: () => void;
}) {
  const [faucet, setFaucet] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [faucetMsg, setFaucetMsg] = useState('');
  const drip = async () => {
    if (!owner) return;
    setFaucet('busy');
    try {
      const r = await fetch('/api/devnet/faucet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner }),
      });
      const j = (await r.json()) as {
        error?: string;
        minted?: Array<{ label: string; amount: string }>;
      };
      if (!r.ok) throw new Error(j.error ?? 'faucet failed');
      setFaucetMsg(
        (j.minted ?? [])
          .map((m) => `${Number(m.amount).toLocaleString('en-US')} ${m.label}`)
          .join(' + '),
      );
      setFaucet('done');
      onFaucet();
    } catch (e) {
      setFaucetMsg(e instanceof Error ? e.message : 'faucet failed');
      setFaucet('error');
    }
  };
  const opts: Array<{
    id: Method;
    title: string;
    blurb: string;
    disabled?: boolean;
    note?: string;
  }> = [
    {
      id: 'usdc',
      title: 'Buy with USDC',
      blurb: `Swap USDC → ${symbol} through Jupiter and back it in one transaction.`,
      ...(isDevnet
        ? {
            disabled: true,
            note: 'Mainnet only. Devnet Arenas use devnet test tokens — no Jupiter route.',
          }
        : { note: 'Route and price from Jupiter (mainnet, indicative).' }),
    },
    {
      id: 'holdings',
      title: 'Use existing holdings',
      blurb: `Move ${symbol} you already own into your Arena Position Vault.`,
      note: isDevnet
        ? `Devnet ${symbol} test tokens in your wallet.`
        : `Mainnet ${symbol} in your wallet.`,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Funding method">
        {opts.map((op) => {
          const bal = op.id === 'usdc' ? usdcBal : assetBal;
          const sel = method === op.id;
          return (
            <button
              key={op.id}
              type="button"
              role="radio"
              aria-checked={sel}
              disabled={op.disabled}
              onClick={() => setMethod(op.id)}
              className={`flex flex-col gap-1 rounded-[14px] border p-3.5 text-left transition-colors disabled:opacity-50 ${sel ? 'border-volt bg-[color-mix(in_oklab,var(--volt)_8%,transparent)]' : 'border-line hover:border-line-strong'}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{op.title}</span>
                {connected && !op.disabled ? (
                  <span className="tnum text-xs text-fg-muted">
                    {bal.state === 'loading'
                      ? 'balance…'
                      : bal.state === 'ok'
                        ? `${op.id === 'usdc' ? fmtUsd(bal.amount, { cents: true }) : fmtAmount(bal.amount, symbol)} · ${bal.cluster}`
                        : bal.state === 'error'
                          ? 'balance unavailable'
                          : ''}
                  </span>
                ) : null}
              </span>
              <span className="text-sm text-fg-muted">{op.blurb}</span>
              {op.note ? <span className="text-xs text-fg-faint">{op.note}</span> : null}
            </button>
          );
        })}
      </div>
      {!connected ? (
        <p className="text-xs text-fg-muted">
          Connect a wallet later to see balances — you can preview everything first.
        </p>
      ) : null}
      {isDevnet ? (
        <div className="flex flex-col gap-2 rounded-[12px] border border-dashed border-line-strong px-3 py-2.5 text-xs text-fg-muted">
          <p>
            Devnet demo: you need devnet {symbol} for the position and a little devnet USDC for the
            0.50% fee (Circle&apos;s devnet faucet). Test tokens come from Tribe&apos;s faucet.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!connected || faucet === 'busy'}
              onClick={() => void drip()}
            >
              {faucet === 'busy' ? 'Minting…' : `Get devnet ${symbol}`}
            </Button>
            {faucet === 'done' ? <span className="text-rise">Sent {faucetMsg}</span> : null}
            {faucet === 'error' ? <span className="text-ember">{faucetMsg}</span> : null}
            {!connected ? <span>Connect a wallet first.</span> : null}
          </div>
        </div>
      ) : null}
      <Button variant="asset" size="lg" onClick={onNext} className="w-full" data-testid="back-next">
        Continue
      </Button>
    </div>
  );
}

function AmountStep({
  method,
  symbol,
  price,
  amountStr,
  setAmountStr,
  preview,
  quote,
  usdcBal,
  assetBal,
  isDemo,
  onNext,
}: {
  method: Method;
  symbol: string;
  price: number;
  amountStr: string;
  setAmountStr: (v: string) => void;
  preview: BackPreview;
  quote: Quote | null | 'loading' | 'unavailable';
  usdcBal: number | null;
  assetBal: number | null;
  isDemo: boolean;
  onNext: () => void;
}) {
  const usdc = method === 'usdc';
  const bal = usdc ? usdcBal : assetBal;
  const insufficient =
    bal !== null && (usdc ? preview.totalUsdc > bal : preview.units > bal) && !isDemo;
  const valid = preview.notionalUsd > 0 && !preview.belowMinimum && !insufficient;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="micro text-fg-muted">
          {usdc ? 'Amount in USDC' : `Amount in ${symbol}`}
        </span>
        <span className="flex items-center gap-2 rounded-[14px] border border-line bg-bg-sunken px-4 py-3 focus-within:border-line-strong">
          {usdc ? <span className="text-xl text-fg-muted">$</span> : null}
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="tnum w-full bg-transparent text-2xl font-bold outline-none placeholder:text-fg-faint"
            placeholder="0"
            aria-label={usdc ? 'Amount in USDC' : `Amount in ${symbol}`}
            data-testid="back-amount"
          />
          {!usdc ? <span className="text-sm text-fg-muted">{symbol}</span> : null}
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        {usdc
          ? QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmountStr(String(q))}
                className="h-9 rounded-full border border-line px-3 text-sm font-medium hover:border-line-strong"
              >
                ${q}
              </button>
            ))
          : [0.25, 0.5, 1].map((f) => (
              <button
                key={f}
                type="button"
                disabled={bal === null}
                onClick={() =>
                  bal !== null && setAmountStr(String(Number((bal * f).toPrecision(6))))
                }
                className="h-9 rounded-full border border-line px-3 text-sm font-medium hover:border-line-strong disabled:opacity-40"
              >
                {f === 1 ? 'MAX' : `${f * 100}%`}
              </button>
            ))}
        {bal !== null ? (
          <span className="ml-auto self-center text-xs text-fg-muted">
            Balance: {usdc ? fmtUsd(bal, { cents: true }) : fmtAmount(bal, symbol)}
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Cell
          k={usdc ? `Est. ${symbol} received` : 'Backing value'}
          v={usdc ? fmtAmount(preview.units, symbol) : fmtUsd(preview.notionalUsd, { cents: true })}
        />
        <Cell k="Tribe fee (0.50%)" v={fmtUsd(preview.feeUsd, { cents: true })} />
        <Cell
          k="Multiplier"
          v={fmtMultiplier(preview.multiplier)}
          tone={preview.multiplier > 1.005 ? 'gold' : undefined}
        />
        <Cell
          k="Est. reward share"
          v={`${(preview.estShare * 100).toFixed(2)}% · ${fmtUsd(preview.estRewardUsd, { cents: true })}`}
          hint="if held to the end — estimate"
        />
      </dl>
      {usdc ? (
        <p className="text-xs text-fg-muted">
          {quote === 'loading'
            ? 'Fetching Jupiter route…'
            : quote === 'unavailable'
              ? `Jupiter quote unavailable right now — estimate uses the Arena reference price ${fmtPrice(price)}.`
              : quote
                ? `Route: ${quote.routeLabel} · impact ${quote.priceImpactPct.toFixed(3)}% · slippage ${quote.slippageBps / 100}% · Jupiter mainnet, indicative`
                : `Estimate uses the Arena reference price ${fmtPrice(price)}.`}
        </p>
      ) : null}
      {preview.belowMinimum ? (
        <p className="inline-flex items-center gap-2 text-sm text-ember">
          <TriangleAlert size={16} aria-hidden /> Minimum backing is {fmtUsd(preview.minimumUsd)}.
        </p>
      ) : null}
      {insufficient ? (
        <p className="inline-flex items-center gap-2 text-sm text-ember">
          <TriangleAlert size={16} aria-hidden /> Not enough {usdc ? 'USDC' : symbol} in this
          wallet.
        </p>
      ) : null}
      <Button
        variant="asset"
        size="lg"
        onClick={onNext}
        disabled={!valid}
        className="w-full"
        data-testid="back-next"
      >
        Preview
      </Button>
    </div>
  );
}

function PreviewStep({
  preview,
  arena,
  side,
  onNext,
}: {
  preview: BackPreview;
  arena: ArenaView;
  side: SideKey;
  onNext: () => void;
}) {
  const s = sideOf(arena, side);
  const rows: Array<[string, string, string?]> = [
    [
      preview.method === 'usdc' ? 'You spend' : 'You commit',
      preview.method === 'usdc'
        ? `${fmtUsd(preview.totalUsdc, { cents: true })} USDC`
        : fmtAmount(preview.units, s.asset.symbol),
    ],
    [
      'You receive / hold',
      `${fmtAmount(preview.units, s.asset.symbol)} (≈ ${fmtUsd(preview.notionalUsd, { cents: true })})`,
    ],
    [
      'Tribe fee',
      `${fmtUsd(preview.feeUsd, { cents: true })} · 40% pool / 40% protocol / 20% creator`,
    ],
    [
      'Asset goes to',
      'Your Tribe Position Vault — a token account only your wallet can withdraw from',
    ],
    [
      'Arena position',
      `${s.asset.symbol} side · ${fmtMultiplier(preview.multiplier)} weight · est. ${(preview.estShare * 100).toFixed(2)}% of the pool`,
    ],
    ['You can exit', 'Any time. After the Arena ends, in full with any reward.'],
    ['Early exit', 'Returns your asset but forfeits this position’s reward weight.'],
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="divide-y divide-line rounded-[14px] border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[120px_1fr] gap-3 px-3 py-2.5 text-sm">
            <dt className="micro self-center text-fg-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="inline-flex items-start gap-2 text-xs text-fg-muted">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-volt" aria-hidden />
        Your Arena units are held in your Tribe Position Vault while participating. You keep
        economic ownership and can exit according to Arena rules. Losing principal never moves to
        the winners.
      </p>
      <Button variant="asset" size="lg" onClick={onNext} className="w-full" data-testid="back-next">
        {arena.provenance === 'demo' ? 'Continue (demo)' : 'Confirm in wallet'}
      </Button>
    </div>
  );
}

function ConfirmStep({
  preview,
  isDemo,
  tx,
  connected,
  canSign,
  onRun,
  onRetry,
}: {
  preview: BackPreview;
  isDemo: boolean;
  tx: { state: TxState; sig?: string; error?: string };
  connected: boolean;
  canSign: boolean;
  onRun: () => void;
  onRetry: () => void;
}) {
  const states: Array<[TxState, string]> = [
    ['preparing', 'Preparing transaction'],
    ['awaiting', isDemo ? 'Simulating wallet approval' : 'Awaiting wallet approval'],
    ['submitted', isDemo ? 'Simulating confirmation' : 'Submitted — confirming'],
    ['confirmed', 'Confirmed'],
  ];
  const order = states.map((x) => x[0]);
  const cur = order.indexOf(tx.state);
  if (!isDemo && !connected) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <p className="text-sm text-fg-muted">
          Connect a Solana wallet on devnet to sign this transaction.
        </p>
        <WalletControl />
      </div>
    );
  }
  if (!isDemo && connected && !canSign) {
    return (
      <p className="rounded-[12px] bg-bg-sunken px-3 py-3 text-sm text-fg-muted">
        This wallet cannot sign transactions here. Try a different wallet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <ol className="flex flex-col gap-2">
        {states.map(([st, label], i) => {
          const done = cur > i || tx.state === 'confirmed';
          const active = cur === i && tx.state !== 'confirmed';
          return (
            <li
              key={st}
              className={`flex items-center gap-3 text-sm ${done ? 'text-fg' : active ? 'text-fg' : 'text-fg-faint'}`}
            >
              <span
                className={`inline-flex size-6 items-center justify-center rounded-full border ${done ? 'border-volt bg-volt text-[#0e0f12]' : active ? 'border-volt' : 'border-line'}`}
              >
                {done ? (
                  <Check size={14} aria-hidden />
                ) : active ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : null}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
      {tx.state === 'failed' ? (
        <div className="rounded-[12px] border border-fall/40 bg-[color-mix(in_oklab,var(--fall)_10%,transparent)] px-3 py-3 text-sm">
          <p className="font-semibold text-fall">Transaction failed</p>
          <p className="text-fg-muted">{tx.error}</p>
        </div>
      ) : null}
      {tx.state === 'idle' ? (
        <Button
          variant="asset"
          size="lg"
          onClick={onRun}
          className="w-full"
          data-testid="back-confirm"
        >
          {isDemo ? `Back ${preview.symbol} (demo)` : `Sign & back ${preview.symbol}`}
        </Button>
      ) : tx.state === 'failed' ? (
        <Button variant="secondary" size="lg" onClick={onRetry} className="w-full">
          Try again
        </Button>
      ) : null}
      {isDemo ? (
        <p className="text-center text-xs text-fg-faint">Demo — no transaction is sent.</p>
      ) : null}
    </div>
  );
}

function SuccessStep({
  arena,
  side,
  record,
  sig,
  onClose,
}: {
  arena: ArenaView;
  side: SideKey;
  record: PositionRecord;
  sig: string | undefined;
  onClose: () => void;
}) {
  const s = sideOf(arena, side);
  const o = sideOf(arena, otherSide(side));
  return (
    <div className="flex flex-col gap-4" data-testid="back-success">
      <div className="asset-tint flex flex-col items-center gap-2 rounded-[18px] p-5 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-volt text-[#0e0f12]">
          <Check size={24} strokeWidth={2.5} aria-hidden />
        </span>
        <p className="display text-2xl font-extrabold">YOU&apos;RE BACKING {s.asset.symbol}</p>
        <p className="text-sm text-fg-muted">
          You own {fmtAmount(record.units, s.asset.symbol)} (≈{' '}
          {fmtUsd(record.usdAtEntry, { cents: true })}). It&apos;s in the Arena.
        </p>
        <ProvenanceBadge provenance={record.provenance} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Cell
          k="Matchup"
          v={`${s.asset.symbol} ${fmtPct(s.perfPct)} · ${o.asset.symbol} ${fmtPct(o.perfPct)}`}
        />
        <Cell
          k="Your weight"
          v={`${fmtMultiplier(record.multiplierAtEntry)} · from now`}
          tone={record.multiplierAtEntry > 1.005 ? 'gold' : undefined}
        />
      </dl>
      {sig ? (
        <a
          href={explorerTxUrl(sig)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-center font-mono text-xs text-[#9db3ff] hover:underline"
        >
          {sig.slice(0, 8)}…{sig.slice(-8)} <ExternalLink size={12} aria-hidden />
        </a>
      ) : (
        <p className="text-center text-xs text-fg-faint">
          Demo position saved on this device only. No transaction was sent.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <ShareArena arena={arena} />
        <Link
          href="/my-arenas"
          onClick={onClose}
          className="inline-flex h-11 items-center justify-center rounded-[12px] bg-volt px-4 text-[15px] font-semibold text-[#0e0f12]"
        >
          My Arenas
        </Link>
      </div>
    </div>
  );
}

/* ─────────────────────────── bits ─────────────────────────── */

function Cell({
  k,
  v,
  tone,
  hint,
}: {
  k: string;
  v: string;
  tone?: 'gold' | 'ember' | undefined;
  hint?: string;
}) {
  return (
    <div className="rounded-[12px] bg-bg-sunken px-3 py-2">
      <dt className="micro text-fg-muted">{k}</dt>
      <dd
        className={`tnum mt-0.5 font-semibold ${tone === 'gold' ? 'text-gold' : tone === 'ember' ? 'text-ember' : ''}`}
      >
        {v}
      </dd>
      {hint ? <dd className="text-[11px] text-fg-faint">{hint}</dd> : null}
    </div>
  );
}

function stepLabel(step: Step): string {
  return {
    side: 'Step 1 · Side',
    method: 'Step 2 · Funding',
    amount: 'Step 3 · Amount',
    preview: 'Step 4 · Preview',
    confirm: 'Step 5 · Confirm',
    success: 'Done',
  }[step];
}

function prev(step: Step): Step {
  return {
    side: 'side',
    method: 'side',
    amount: 'method',
    preview: 'amount',
    confirm: 'preview',
    success: 'success',
  }[step] as Step;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function friendlyError(msg: string): string {
  if (/insufficient|0x1\b/i.test(msg))
    return 'Not enough tokens or SOL for fees in this wallet on devnet.';
  if (/BackingClosed/.test(msg)) return 'Backing closed while you were signing.';
  if (/BelowMinimumBacking/.test(msg)) return 'Amount is below the Arena minimum.';
  if (/blockhash/i.test(msg)) return 'The transaction expired before it was confirmed. Try again.';
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}

'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { WalletControl } from '@/components/layout/WalletControl';
import { useDemoPositions } from '@/hooks/useDemoPositions';
import { useLiveArenas } from '@/hooks/useLiveArenas';
import { useNow } from '@/hooks/useNow';
import type { ArenaView } from '@/lib/arena/model';
import { fmtUsd } from '@/lib/format';
import { getNetworkConfig } from '@/lib/config/network';
import { positionInsight, type PositionBucket, type PositionRecord } from '@/lib/positions/model';
import { verifyTribeTransaction } from '@/lib/protocol/verify';

import { ButtonLink } from '../ui/Button';
import { PositionCard } from './PositionCard';

const BUCKETS: Array<{ id: PositionBucket; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'claimable', label: 'Claimable' },
  { id: 'completed', label: 'Completed' },
  { id: 'exited', label: 'Exited' },
];

interface DevnetRow {
  address: string;
  arena: string;
  side: 'a' | 'b';
  units: number;
  entryTs: number;
  claimed: boolean;
  forfeited: boolean;
}

export function MyArenas({
  initialArenas,
  serverNow,
}: {
  initialArenas: ArenaView[];
  serverNow: number;
}) {
  const now = useNow(serverNow);
  const live = useLiveArenas(initialArenas, serverNow);
  const arenas = live.data;
  const demo = useDemoPositions();
  const wallet = useWallet();
  const { connection } = useConnection();
  const owner = wallet.publicKey?.toBase58() ?? null;
  const [devnetRes, setDevnetRes] = useState<{ key: string; rows: DevnetRow[] | 'error' } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const devnetKey = owner ? `${owner}:${live.updatedAt}` : null;
  useEffect(() => {
    if (!owner || !devnetKey) return;
    let alive = true;
    fetch(`/api/positions?owner=${owner}`, { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ data?: DevnetRow[] }>)
      .then((j) => alive && setDevnetRes({ key: devnetKey, rows: j.data ?? [] }))
      .catch(() => alive && setDevnetRes({ key: devnetKey, rows: 'error' }));
    return () => {
      alive = false;
    };
  }, [owner, devnetKey]);
  // keep the last good rows while a refresh is in flight
  const devnetRows = useMemo<DevnetRow[] | 'loading' | 'error'>(
    () => (!owner ? [] : devnetRes ? devnetRes.rows : 'loading'),
    [owner, devnetRes],
  );

  const bySlug = useMemo(() => new Map(arenas.map((a) => [a.slug, a])), [arenas]);
  const byOnchain = useMemo(
    () => new Map(arenas.filter((a) => a.onchain).map((a) => [a.onchain!.arena, a])),
    [arenas],
  );

  const rows = useMemo(() => {
    const out: Array<{ p: PositionRecord; arena: ArenaView }> = [];
    for (const p of demo.positions) {
      const a = bySlug.get(p.arenaSlug);
      if (a) out.push({ p, arena: a });
    }
    if (Array.isArray(devnetRows)) {
      for (const r of devnetRows) {
        const a = byOnchain.get(r.arena);
        if (!a) continue;
        const s = r.side === 'a' ? a.sides[0] : a.sides[1];
        const units = r.units / 10 ** s.asset.decimals;
        if (units === 0 && !r.claimed) continue; // fully exited
        out.push({
          arena: a,
          p: {
            id: `devnet-${r.address}`,
            provenance: 'onchain',
            arenaSlug: a.slug,
            arenaId: a.id,
            side: r.side,
            units,
            entryTs: r.entryTs,
            usdAtEntry: units * s.startPrice,
            feeUsd: 0,
            multiplierAtEntry: 1,
            status: r.claimed ? 'claimed' : units === 0 ? 'exited' : 'active',
            address: r.address,
            forfeited: r.forfeited,
          },
        });
      }
    }
    return out;
  }, [demo.positions, devnetRows, bySlug, byOnchain]);

  const grouped = useMemo(() => {
    const g: Record<PositionBucket, Array<{ p: PositionRecord; arena: ArenaView }>> = {
      active: [],
      claimable: [],
      completed: [],
      exited: [],
    };
    for (const r of rows) g[positionInsight(r.p, r.arena, now).bucket].push(r);
    return g;
  }, [rows, now]);

  const totalValue = rows
    .filter((r) => r.p.status === 'active')
    .reduce((acc, r) => acc + positionInsight(r.p, r.arena, now).valueUsd, 0);

  const signAndSend = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<string> => {
      if (!wallet.publicKey || !wallet.signTransaction) throw new Error('connect a wallet');
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: wallet.publicKey.toBase58(), ...body }),
      });
      const j = (await r.json()) as { tx?: string; error?: string };
      if (!r.ok || !j.tx) throw new Error(j.error ?? 'could not build transaction');
      const t = Transaction.from(Buffer.from(j.tx, 'base64'));
      verifyTribeTransaction(t, {
        programId: getNetworkConfig().protocol.programId,
        arena: String(body['arena']),
        owner: wallet.publicKey.toBase58(),
      });
      const signed = await wallet.signTransaction(t);
      const sig = await connection.sendRawTransaction(signed.serialize());
      const bh = await connection.getLatestBlockhash();
      const c = await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
      if (c.value.err) throw new Error('transaction failed on-chain');
      return sig;
    },
    [wallet, connection],
  );

  const onExit = useCallback(
    async (p: PositionRecord) => {
      const arena = bySlug.get(p.arenaSlug);
      if (!arena) return;
      const early = now < arena.endTs && arena.status !== 'cancelled';
      if (
        early &&
        !window.confirm(
          `Exit now? Your ${arena.sides[p.side === 'a' ? 0 : 1].asset.symbol} comes back to your wallet, and this position's Arena Rewards are forfeited.`,
        )
      )
        return;
      if (p.provenance === 'demo') {
        demo.update(p.id, { status: 'exited', forfeited: early });
        setNotice('Demo position exited — nothing was sent.');
        return;
      }
      if (!arena.onchain) return;
      setBusy(p.id);
      try {
        const sig = await signAndSend('/api/protocol/exit', {
          arena: arena.onchain.arena,
          side: p.side,
        });
        setNotice(`Withdrawn on devnet · ${sig.slice(0, 8)}…`);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'exit failed');
      } finally {
        setBusy(null);
      }
    },
    [bySlug, now, demo, signAndSend],
  );

  const onClaim = useCallback(
    async (p: PositionRecord) => {
      const arena = bySlug.get(p.arenaSlug);
      if (!arena) return;
      if (p.provenance === 'demo') {
        demo.update(p.id, { status: 'claimed' });
        setNotice('Demo reward claimed — nothing was sent.');
        return;
      }
      if (!arena.onchain) return;
      setBusy(p.id);
      try {
        const sig = await signAndSend('/api/protocol/claim', {
          arena: arena.onchain.arena,
          side: p.side,
        });
        setNotice(`Reward claimed on devnet · ${sig.slice(0, 8)}…`);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'claim failed');
      } finally {
        setBusy(null);
      }
    },
    [bySlug, demo, signAndSend],
  );

  const empty = rows.length === 0;

  return (
    <main className="container-x flex flex-col gap-6 py-4 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="display text-3xl font-extrabold tracking-tight">My Arenas</h1>
          <p className="text-sm text-fg-muted">
            You own positions, not bets. Every asset here is yours whatever the Arena decides.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {rows.length > 0 ? (
            <div className="text-right">
              <p className="micro text-fg-muted">In Arenas</p>
              <p className="display tnum text-2xl font-extrabold">
                {fmtUsd(totalValue, { cents: true })}
              </p>
            </div>
          ) : null}
          <WalletControl />
        </div>
      </div>

      {notice ? (
        <p className="rounded-[12px] border border-line bg-bg-elev px-3 py-2 text-sm" role="status">
          {notice}
          <button
            type="button"
            className="ml-3 text-fg-muted hover:text-fg"
            onClick={() => setNotice(null)}
          >
            dismiss
          </button>
        </p>
      ) : null}
      {busy ? (
        <p className="text-sm text-fg-muted" role="status">
          Waiting for your wallet…
        </p>
      ) : null}

      {devnetRows === 'error' ? (
        <p className="text-sm text-ember-fg">
          Couldn&apos;t load devnet positions right now. Demo positions are still shown.
        </p>
      ) : null}

      {empty ? (
        <div className="flex flex-col items-center gap-3 rounded-[24px] border border-dashed border-line-strong px-6 py-16 text-center">
          <p className="display text-2xl font-extrabold">No positions yet.</p>
          <p className="max-w-md text-sm text-fg-muted">
            {owner
              ? 'This wallet has no Arena positions on devnet, and no demo positions on this device. Back a side to get started.'
              : 'Back a side in any Arena to see it here. Demo Arenas work without a wallet; devnet Arenas show your on-chain positions once you connect.'}
          </p>
          <ButtonLink href="/" variant="primary">
            Explore Arenas
          </ButtonLink>
        </div>
      ) : (
        BUCKETS.map((b) => {
          const list = grouped[b.id];
          if (list.length === 0) return null;
          return (
            <section key={b.id} className="flex flex-col gap-3" aria-labelledby={`bucket-${b.id}`}>
              <h2 id={`bucket-${b.id}`} className="display text-xl font-bold">
                {b.label} <span className="text-fg-faint">{list.length}</span>
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {list.map(({ p, arena }) => (
                  <PositionCard
                    key={p.id}
                    position={p}
                    arena={arena}
                    now={now}
                    onExit={(x) => void onExit(x)}
                    onClaim={(x) => void onClaim(x)}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {demo.positions.length > 0 ? (
        <button
          type="button"
          className="self-start text-xs text-fg-faint hover:text-fg"
          onClick={() => demo.clear()}
        >
          Clear demo positions on this device
        </button>
      ) : null}
    </main>
  );
}

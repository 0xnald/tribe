'use client';

import { ExternalLink, Trophy } from 'lucide-react';
import Link from 'next/link';

import { otherSide, sideOf, type ArenaView } from '@/lib/arena/model';
import { explorerTxUrl } from '@/lib/config/network';
import { fmtAmount, fmtDuration, fmtMultiplier, fmtPct, fmtTime, fmtUsd } from '@/lib/format';
import { positionInsight, type PositionRecord } from '@/lib/positions/model';

import { AssetLogo } from '../arena/AssetIdentity';
import { ProvenanceBadge } from '../arena/ProvenanceBadge';
import { StatusPill } from '../arena/StatusPill';
import { Button } from '../ui/Button';

/**
 * My Arenas card (DESIGN_SYSTEM §6.9). The two numbers that matter are
 * kept apart on purpose: what *your asset* did since you backed it, and
 * how the *Arena* stands. Losing an Arena does not mean your asset lost.
 */
export function PositionCard({
  position,
  arena,
  now,
  onExit,
  onClaim,
}: {
  position: PositionRecord;
  arena: ArenaView;
  now: number;
  onExit?: (p: PositionRecord) => void;
  onClaim?: (p: PositionRecord) => void;
}) {
  const s = sideOf(arena, position.side);
  const o = sideOf(arena, otherSide(position.side));
  const ins = positionInsight(position, arena, now);
  const settled = arena.status === 'settled';
  const exited = position.status === 'exited';

  return (
    <article
      className="relative isolate flex flex-col gap-4 overflow-hidden rounded-[20px] border border-line bg-bg-elev p-4 md:p-5"
      style={{ ['--asset' as string]: s.asset.color }}
      data-testid="position-card"
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden
        style={{
          background: `linear-gradient(135deg, color-mix(in oklab, ${s.asset.color} 16%, transparent), transparent 55%)`,
        }}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <AssetLogo asset={s.asset} size={36} />
        <div className="flex flex-col leading-tight">
          <span className="display text-lg font-extrabold">
            {fmtAmount(position.units, s.asset.symbol)}
          </span>
          <span className="text-xs text-fg-muted">
            <Link href={`/arena/${arena.slug}`} className="hover:text-fg hover:underline">
              {s.asset.symbol} vs {o.asset.symbol}
            </Link>{' '}
            · backed {fmtTime(position.entryTs)}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusPill arena={arena} now={now} />
          <ProvenanceBadge provenance={position.provenance} />
        </div>
      </div>

      {/* the distinction */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-[14px] bg-bg-sunken p-3">
          <p className="micro text-fg-muted">Your {s.asset.symbol}</p>
          <p
            className={`tnum display text-2xl font-extrabold ${ins.ownPct > 0 ? 'text-rise' : ins.ownPct < 0 ? 'text-fall' : ''}`}
          >
            {fmtPct(ins.ownPct)}
          </p>
          <p className="text-xs text-fg-muted">
            worth {fmtUsd(ins.valueUsd, { cents: true })} · you paid{' '}
            {fmtUsd(position.usdAtEntry, { cents: true })}
          </p>
        </div>
        <div className="rounded-[14px] bg-bg-sunken p-3">
          <p className="micro text-fg-muted">Arena result</p>
          <p className="display text-2xl font-extrabold">
            {settled && ins.won !== null ? (
              ins.won ? (
                <span className="inline-flex items-center gap-1.5 text-volt-fg">
                  <Trophy size={20} aria-hidden /> {s.asset.symbol} won
                </span>
              ) : (
                <span>{o.asset.symbol} won</span>
              )
            ) : settled ? (
              'Draw'
            ) : arena.status === 'cancelled' ? (
              'Cancelled'
            ) : ins.leading ? (
              <span>
                {s.asset.symbol} leads by {ins.leadPct.toFixed(2)}%
              </span>
            ) : ins.leadPct < -0.005 ? (
              <span>
                {s.asset.symbol} trails by {Math.abs(ins.leadPct).toFixed(2)}%
              </span>
            ) : (
              'Dead even'
            )}
          </p>
          <p className="text-xs text-fg-muted">
            {s.asset.symbol} {fmtPct(ins.sidePct)} · {o.asset.symbol} {fmtPct(ins.opponentPct)}{' '}
            since Arena start
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
        <Kv k="Time held" v={fmtDuration(ins.timeHeldSecs)} />
        <Kv
          k="Conviction weight"
          v={
            exited && position.forfeited
              ? 'forfeited'
              : `${fmtMultiplier(position.multiplierAtEntry)} · ${Math.round(ins.weight).toLocaleString('en-US')}`
          }
        />
        <Kv
          k={settled ? 'Arena reward' : 'Est. reward if held'}
          v={
            settled && ins.won === false
              ? '—'
              : `${fmtUsd(ins.estRewardUsd, { cents: true })}${settled ? '' : ' est.'}`
          }
          tone={ins.estRewardUsd > 0 ? 'gold' : undefined}
        />
        <Kv
          k={
            arena.status === 'live' && now < arena.backingCloseTs ? 'Backing closes' : 'Arena ends'
          }
          v={
            arena.status === 'live' && now < arena.backingCloseTs
              ? fmtDuration(arena.backingCloseTs - now)
              : fmtTime(arena.endTs)
          }
        />
      </dl>

      {position.txSig ? (
        <a
          href={explorerTxUrl(position.txSig)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-start font-mono text-xs text-devnet-fg hover:underline"
        >
          {position.txSig.slice(0, 8)}…{position.txSig.slice(-6)}{' '}
          <ExternalLink size={12} aria-hidden />
        </a>
      ) : null}

      {/* actions */}
      {exited ? (
        <p className="text-xs text-fg-muted">
          Exited{position.forfeited ? ' early — Arena Rewards forfeited' : ''}. Your{' '}
          {s.asset.symbol} is back in your wallet.
        </p>
      ) : position.status === 'claimed' ? (
        <p className="text-xs text-fg-muted">Reward claimed and asset withdrawn.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {ins.bucket === 'claimable' ? (
            <Button variant="primary" onClick={() => onClaim?.(position)} data-testid="claim">
              Claim reward
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onExit?.(position)} data-testid="exit">
            {ins.bucket === 'active' && now < arena.endTs ? 'Exit position' : 'Withdraw'}
          </Button>
          {ins.bucket === 'claimable' ? (
            <Button
              variant="ghost"
              disabled
              title="Victory Roll needs the next Arena to be live — Phase 4"
            >
              Victory Roll · soon
            </Button>
          ) : null}
          {ins.bucket === 'active' && now < arena.endTs ? (
            <span className="self-center text-xs text-fg-faint">
              Exiting now forfeits this position&apos;s Arena Rewards.
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: 'gold' | undefined }) {
  return (
    <div>
      <dt className="micro text-fg-muted">{k}</dt>
      <dd className={`tnum font-semibold ${tone === 'gold' ? 'text-gold-fg' : ''}`}>{v}</dd>
    </div>
  );
}

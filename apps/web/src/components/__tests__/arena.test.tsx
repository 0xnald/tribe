// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { FIXTURE_DEFS, buildFixtureArena } from '@/lib/arena/fixtures';
import type { ArenaView } from '@/lib/arena/model';

import { ArenaCard } from '../arena/ArenaCard';
import { ArenaHero } from '../arena/ArenaHero';
import { ArenaPanels } from './helpers';
import { Countdown } from '../arena/Countdown';
import { ProvenanceBadge } from '../arena/ProvenanceBadge';
import { TooltipProvider } from '../ui/Tooltip';

const NOW = 1_789_300_000;

function wrap(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function fixture(slug: string, now = NOW): ArenaView {
  const def = FIXTURE_DEFS.find((d) => d.slug === slug)!;
  return buildFixtureArena(def, now);
}

describe('ArenaCard', () => {
  it('shows both identities, performance, leader, countdown, backing split and provenance', () => {
    const a = fixture('sol-vs-spyx');
    wrap(<ArenaCard arena={a} now={NOW} />);
    const card = screen.getByTestId('arena-card');
    expect(within(card).getAllByText('SOL').length).toBeGreaterThan(0);
    expect(within(card).getAllByText('SPYx').length).toBeGreaterThan(0);
    // performance readouts carry sign + two decimals
    const perfA = a.sides[0].perfPct;
    const sign = perfA > 0 ? '+' : perfA < 0 ? '−' : '';
    expect(within(card).getByText(`${sign}${Math.abs(perfA).toFixed(2)}%`)).toBeInTheDocument();
    // leader line
    const leader = a.leader === 'a' ? 'SOL' : 'SPYx';
    expect(within(card).getByText(`${leader} leads`)).toBeInTheDocument();
    // backing split labels add up to 100
    const pctA = Math.round(a.sides[0].backingShare * 100);
    expect(within(card).getByText(`${pctA}%`)).toBeInTheDocument();
    expect(within(card).getByText(`${100 - pctA}%`)).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: /backing split/i })).toBeInTheDocument();
    // countdown as HH:MM:SS
    expect(within(card).getByText(/^(\d+d )?\d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
    // provenance
    expect(within(card).getByRole('button', { name: /DEMO data/i })).toBeInTheDocument();
    // CTAs
    expect(within(card).getByRole('button', { name: 'BACK SOL' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'BACK SPYx' })).toBeInTheDocument();
    // whole card links to the Arena
    expect(within(card).getByRole('link', { name: /SOL vs SPYx Arena/ })).toHaveAttribute(
      'href',
      '/arena/sol-vs-spyx',
    );
  });

  it('hides Back buttons once backing is closed and on settled Arenas', () => {
    wrap(<ArenaCard arena={fixture('bonk-vs-tslax')} now={NOW} />);
    expect(screen.queryByRole('button', { name: /^BACK / })).not.toBeInTheDocument();
    expect(screen.getByText(/LIVE · LOCKED/)).toBeInTheDocument();
  });

  it('renders scheduled and cancelled states without performance', () => {
    const { unmount } = wrap(<ArenaCard arena={fixture('sol-vs-nvdax-next')} now={NOW} />);
    expect(screen.getByText(/^Opens /)).toBeInTheDocument();
    expect(screen.getByText('SCHEDULED')).toBeInTheDocument();
    unmount();
    wrap(<ArenaCard arena={fixture('pengu-vs-gmex-cancelled')} now={NOW} />);
    expect(screen.getByText('CANCELLED')).toBeInTheDocument();
    expect(screen.getByText(/everything withdrawable/i)).toBeInTheDocument();
  });
});

describe('ArenaHero', () => {
  it('states the lead and the backing share in plain words', () => {
    const a = fixture('sol-vs-spyx');
    wrap(<ArenaHero arena={a} now={NOW} />);
    const hero = screen.getByTestId('arena-hero');
    expect(within(hero).getByText(/leads by/)).toBeInTheDocument();
    expect(
      within(hero).getByText(
        new RegExp(`${Math.round(a.sides[0].backingShare * 100)}% of Tribe backing SOL`),
      ),
    ).toBeInTheDocument();
    expect(within(hero).getByTestId('hero-back-a')).toHaveTextContent('BACK SOL');
    expect(within(hero).getByText('Own what you believe in.')).toBeInTheDocument();
  });

  it('announces the winner on a settled Arena and offers no Back button', () => {
    const a = fixture('bonk-vs-tslax-round-1');
    wrap(<ArenaHero arena={a} now={NOW} />);
    const winner = a.winner === 'a' ? 'BONK' : 'TSLAx';
    expect(screen.getByText(`${winner} WINS`)).toBeInTheDocument();
    expect(screen.queryByTestId('hero-back-a')).not.toBeInTheDocument();
    expect(screen.getByText(/Arena settled/)).toBeInTheDocument();
  });
});

describe('Countdown', () => {
  it('shows BACKING CLOSES IN then ENDS IN, and tints the last minute', () => {
    const a = fixture('sol-vs-spyx');
    const { rerender } = wrap(<Countdown arena={a} now={NOW} />);
    expect(screen.getByText('BACKING CLOSES IN')).toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <Countdown arena={a} now={a.backingCloseTs + 1} />
      </TooltipProvider>,
    );
    expect(screen.getByText('ENDS IN')).toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <Countdown arena={a} now={a.backingCloseTs - 30} />
      </TooltipProvider>,
    );
    expect(screen.getByText('00:00:30')).toHaveClass('text-ember-fg');
  });
});

describe('ProvenanceBadge', () => {
  it('labels LIVE, DEVNET and DEMO with explanatory accessible names', () => {
    wrap(
      <>
        <ProvenanceBadge provenance="live" />
        <ProvenanceBadge provenance="devnet" />
        <ProvenanceBadge provenance="demo" />
      </>,
    );
    expect(
      screen.getByRole('button', { name: /LIVE data: Live mainnet market data/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /DEVNET data: Real transaction/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /DEMO data: Demo Arena/ })).toBeInTheDocument();
  });
});

describe('MarketPanel', () => {
  it('shows market closed and unavailable prices honestly', () => {
    const a = fixture('bonk-vs-tslax');
    const withMarket: ArenaView = {
      ...a,
      market: [
        {
          quote: {
            mint: a.sides[0].asset.mint,
            usdPrice: 0.0000276,
            change24hPct: -1.6,
            liquidityUsd: 1_020_000,
            source: 'jupiter',
            fetchedAt: 0,
            state: 'ok',
          },
          status: { state: 'open', source: 'always', oracle: 'Pyth Crypto.BONK/USD' },
        },
        {
          quote: {
            mint: a.sides[1].asset.mint,
            usdPrice: null,
            change24hPct: null,
            liquidityUsd: null,
            source: 'unavailable',
            fetchedAt: 0,
            state: 'unavailable',
          },
          status: {
            state: 'closed',
            source: 'xstocks',
            oracle: 'Pyth',
            nextChangeAt: NOW + 3600,
            exchange: 'NASDAQ',
          },
        },
      ],
    };
    wrap(<ArenaPanels.MarketPanel arena={withMarket} />);
    expect(screen.getByText('$0.0000276')).toBeInTheDocument();
    expect(screen.getByText('open 24/7')).toBeInTheDocument();
    expect(screen.getByText('price unavailable')).toBeInTheDocument();
    expect(screen.getByText(/^closed · opens/)).toBeInTheDocument();
  });
});

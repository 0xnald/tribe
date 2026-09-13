// @vitest-environment jsdom
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDemoPositions } from '@/hooks/useDemoPositions';
import { listFixtureArenas } from '@/lib/arena/fixtures';
import type { PositionRecord } from '@/lib/positions/model';

import ErrorPage from '@/app/error';
import { Explore, applyFilter } from '../arena/Explore';
import { MyArenas } from '../positions/MyArenas';
import { TooltipProvider } from '../ui/Tooltip';

const NOW = 1_789_300_000;
const arenas = listFixtureArenas(NOW);

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn() }),
}));

function wrap(ui: ReactNode) {
  return render(
    <ConnectionProvider endpoint="http://127.0.0.1:8899">
      <WalletProvider wallets={[]} autoConnect={false}>
        <TooltipProvider>{ui}</TooltipProvider>
      </WalletProvider>
    </ConnectionProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: arenas, now: NOW }))),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

describe('applyFilter', () => {
  it('live, ending soon (sorted), categories and devnet', () => {
    expect(
      applyFilter(arenas, 'live', NOW).every(
        (a) => a.status === 'live' || a.status === 'backing_closed',
      ),
    ).toBe(true);
    const ending = applyFilter(arenas, 'ending', NOW);
    for (let i = 1; i < ending.length; i++)
      expect(ending[i]!.endTs).toBeGreaterThanOrEqual(ending[i - 1]!.endTs);
    expect(ending.every((a) => a.endTs - NOW < 12 * 3600)).toBe(true);
    expect(
      applyFilter(arenas, 'meme-vs-stock', NOW).every((a) => a.category === 'meme-vs-stock'),
    ).toBe(true);
    expect(applyFilter(arenas, 'stock-vs-stock', NOW).map((a) => a.slug)).toEqual([
      'nvdax-vs-aaplx',
    ]);
    expect(applyFilter(arenas, 'devnet', NOW)).toEqual([]);
  });
});

describe('Explore', () => {
  it('renders the featured hero, the feed without the hero Arena, filters and how-it-works', async () => {
    const user = userEvent.setup();
    wrap(<Explore initial={arenas} serverNow={NOW} />);
    const hero = screen.getByTestId('arena-hero');
    expect(hero).toBeInTheDocument();
    expect(within(hero).getAllByText('BONK').length).toBeGreaterThan(0); // featured matchup
    const feed = screen.getByTestId('arena-feed');
    const slugs = within(feed)
      .getAllByTestId('arena-card')
      .map((c) => c.getAttribute('data-slug'));
    expect(slugs).not.toContain('bonk-vs-tslax'); // the hero is not repeated
    expect(slugs.length).toBeGreaterThan(3);
    expect(screen.getByRole('heading', { name: 'How Tribe works' })).toBeInTheDocument();
    expect(screen.getByText('Pick a side.')).toBeInTheDocument();
    // filter to Stock vs Stock
    await user.click(screen.getByRole('tab', { name: 'Stock vs Stock' }));
    expect(within(screen.getByTestId('arena-feed')).getAllByTestId('arena-card')).toHaveLength(1);
    // devnet filter hidden when there are no devnet Arenas
    expect(screen.queryByRole('tab', { name: 'Devnet protocol' })).not.toBeInTheDocument();
    // narrative drill-down
    await user.click(screen.getByRole('button', { name: /Community Favorites/ }));
    expect(screen.getByText('Narrative:')).toBeInTheDocument();
  });
});

describe('useDemoPositions', () => {
  it('persists to localStorage and updates', () => {
    const { result } = renderHook(() => useDemoPositions());
    const rec: PositionRecord = {
      id: 'p1',
      provenance: 'demo',
      arenaSlug: 'sol-vs-spyx',
      arenaId: 'demo:sol-vs-spyx',
      side: 'a',
      units: 1,
      entryTs: NOW,
      usdAtEntry: 100,
      feeUsd: 0.5,
      multiplierAtEntry: 1,
      status: 'active',
    };
    act(() => result.current.add(rec));
    expect(result.current.positions).toHaveLength(1);
    act(() => result.current.update('p1', { status: 'exited', forfeited: true }));
    expect(result.current.positions[0]).toMatchObject({ status: 'exited', forfeited: true });
    expect(JSON.parse(window.localStorage.getItem('tribe.demoPositions.v1') ?? '[]')).toHaveLength(
      1,
    );
    act(() => result.current.clear());
    expect(result.current.positions).toHaveLength(0);
  });
});

describe('MyArenas', () => {
  it('shows the disconnected empty state', () => {
    wrap(<MyArenas initialArenas={arenas} serverNow={NOW} />);
    expect(screen.getByText('No positions yet.')).toBeInTheDocument();
    expect(screen.getByText(/Demo Arenas work without a wallet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();
  });

  it('groups demo positions into buckets without a wallet', () => {
    const settled = arenas.find((a) => a.slug === 'bonk-vs-tslax-round-1')!;
    const live = arenas.find((a) => a.slug === 'sol-vs-spyx')!;
    const base = {
      provenance: 'demo' as const,
      units: 1,
      feeUsd: 0.5,
      multiplierAtEntry: 1,
      usdAtEntry: 100,
    };
    const recs: PositionRecord[] = [
      {
        ...base,
        id: 'a',
        arenaSlug: live.slug,
        arenaId: live.id,
        side: 'a',
        entryTs: NOW - 3600,
        status: 'active',
      },
      {
        ...base,
        id: 'w',
        arenaSlug: settled.slug,
        arenaId: settled.id,
        side: settled.winner as 'a' | 'b',
        entryTs: settled.startTs,
        status: 'active',
      },
      {
        ...base,
        id: 'x',
        arenaSlug: live.slug,
        arenaId: live.id,
        side: 'b',
        entryTs: NOW - 7200,
        status: 'exited',
        forfeited: true,
      },
    ];
    window.localStorage.setItem('tribe.demoPositions.v1', JSON.stringify(recs));
    wrap(<MyArenas initialArenas={arenas} serverNow={NOW} />);
    expect(screen.getByRole('heading', { name: /^Active/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Claimable/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Exited/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('position-card')).toHaveLength(3);
    expect(screen.getByText('In Arenas')).toBeInTheDocument();
  });
});

describe('error fallback', () => {
  it('never shows a raw error and offers a retry', () => {
    const reset = vi.fn();
    render(
      <ErrorPage
        error={new Error('TypeError: cannot read properties of undefined')}
        reset={reset}
      />,
    );
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.queryByText(/cannot read properties/)).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(reset).toHaveBeenCalled();
  });
});

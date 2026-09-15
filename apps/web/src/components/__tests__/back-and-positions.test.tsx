// @vitest-environment jsdom
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURE_DEFS, buildFixtureArena } from '@/lib/arena/fixtures';
import type { ArenaView } from '@/lib/arena/model';
import type { PositionRecord } from '@/lib/positions/model';

import { BackSheet } from '../back/BackSheet';
import { PositionCard } from '../positions/PositionCard';
import { TooltipProvider } from '../ui/Tooltip';

const NOW = 1_789_300_000;

/** The sheet checks backability against the real clock, so live Arenas must be built for it. */
function liveFixture(slug: string): ArenaView {
  const def = FIXTURE_DEFS.find((d) => d.slug === slug);
  if (!def) throw new Error(`unknown fixture ${slug}`);
  const a = buildFixtureArena(def, Math.floor(Date.now() / 1000));
  if (a.status !== 'live') throw new Error(`${slug} is not live right now (${a.status})`);
  return a;
}

function fixture(slug: string): ArenaView {
  return buildFixtureArena(
    FIXTURE_DEFS.find((d) => d.slug === slug)!,
    NOW,
  );
}

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
  // Jupiter quote route → unavailable, so previews use the Arena reference price deterministically
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: null, reason: 'unavailable' }), { status: 200 }),
    ),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe('BackSheet (demo Arena)', () => {
  it('walks side → method → amount → preview → confirm → success without a wallet, and never sends a transaction', async () => {
    const user = userEvent.setup();
    const a = liveFixture('sol-vs-spyx');
    wrap(<BackSheet open onOpenChange={() => undefined} arena={a} side="b" session={1} />);

    const sheet = await screen.findByTestId('back-sheet');
    expect(sheet).toHaveAttribute('data-step', 'side');
    expect(
      within(sheet).getByText(/to outperform SOL from now until the Arena ends/),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText(/Demo Arena — simulated prices, no transaction/),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByTestId('back-next'));

    // method: both mainnet paths offered for a demo Arena
    expect(sheet).toHaveAttribute('data-step', 'method');
    expect(within(sheet).getByRole('radio', { name: /Buy with USDC/ })).toBeChecked();
    expect(within(sheet).getByRole('radio', { name: /Use existing holdings/ })).not.toBeDisabled();
    await user.click(within(sheet).getByTestId('back-next'));

    // amount: default $100 → fee $0.50, estimate labelled
    expect(sheet).toHaveAttribute('data-step', 'amount');
    expect(within(sheet).getByTestId('back-amount')).toHaveValue(100);
    expect(within(sheet).getByText('Tribe fee (0.50%)')).toBeInTheDocument();
    expect(within(sheet).getByText('$0.50')).toBeInTheDocument();
    expect(within(sheet).getByText(/if held to the end — estimate/)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(sheet).getByText(/Jupiter quote unavailable/)).toBeInTheDocument(),
    );
    await user.click(within(sheet).getByTestId('back-next'));

    // preview: custody in plain language
    expect(sheet).toHaveAttribute('data-step', 'preview');
    expect(within(sheet).getByText('$100.50 USDC')).toBeInTheDocument();
    expect(within(sheet).getByText(/Your Tribe Position Vault/)).toBeInTheDocument();
    expect(within(sheet).getByText(/forfeits this position’s reward weight/)).toBeInTheDocument();
    await user.click(within(sheet).getByTestId('back-next'));

    // confirm: demo runs through the transaction states
    expect(sheet).toHaveAttribute('data-step', 'confirm');
    expect(within(sheet).getByText('Demo — no transaction is sent.')).toBeInTheDocument();
    await user.click(within(sheet).getByTestId('back-confirm'));
    await waitFor(() => expect(sheet).toHaveAttribute('data-step', 'success'), { timeout: 5000 });
    expect(within(sheet).getByText(/YOU'RE BACKING SPYx/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Demo position saved on this device only/)).toBeInTheDocument();

    // persisted as a demo position
    const stored = JSON.parse(
      window.localStorage.getItem('tribe.demoPositions.v1') ?? '[]',
    ) as PositionRecord[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      provenance: 'demo',
      side: 'b',
      usdAtEntry: 100,
      feeUsd: 0.5,
      status: 'active',
    });
    expect(
      (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.every((c) =>
        String(c[0]).startsWith('/api/market/quote'),
      ),
    ).toBe(true);
  });

  it('blocks amounts below the minimum', async () => {
    const user = userEvent.setup();
    const a = liveFixture('sol-vs-spyx');
    wrap(<BackSheet open onOpenChange={() => undefined} arena={a} side="a" session={1} />);
    const sheet = await screen.findByTestId('back-sheet');
    await user.click(within(sheet).getByTestId('back-next'));
    await user.click(within(sheet).getByTestId('back-next'));
    const input = within(sheet).getByTestId('back-amount');
    await user.clear(input);
    await user.type(input, '3');
    expect(within(sheet).getByText(/Minimum backing is \$5/)).toBeInTheDocument();
    expect(within(sheet).getByTestId('back-next')).toBeDisabled();
  });

  it('refuses to continue when backing is closed', async () => {
    const a = fixture('bonk-vs-tslax'); // inside the hold window at the anchor
    wrap(<BackSheet open onOpenChange={() => undefined} arena={a} side="a" session={1} />);
    const sheet = await screen.findByTestId('back-sheet');
    expect(within(sheet).getByText('Backing is closed for this Arena.')).toBeInTheDocument();
    expect(within(sheet).queryByTestId('back-next')).not.toBeInTheDocument();
  });
});

describe('BackSheet (devnet Arena)', () => {
  it('disables the USDC path, and asks for a wallet only at the confirm step', async () => {
    const user = userEvent.setup();
    const base = liveFixture('sol-vs-spyx');
    const devnet: ArenaView = {
      ...base,
      provenance: 'onchain',
      onchain: {
        arena: '11111111111111111111111111111111',
        creator: '11111111111111111111111111111111',
        nonce: '1',
      },
    };
    wrap(<BackSheet open onOpenChange={() => undefined} arena={devnet} side="a" session={1} />);
    const sheet = await screen.findByTestId('back-sheet');
    await user.click(within(sheet).getByTestId('back-next'));
    expect(within(sheet).getByRole('radio', { name: /Buy with USDC/ })).toBeDisabled();
    expect(within(sheet).getByText(/Devnet Arenas use devnet test tokens/)).toBeInTheDocument();
    expect(within(sheet).getByRole('radio', { name: /Use existing holdings/ })).toBeChecked();
    await user.click(within(sheet).getByTestId('back-next'));
    await user.type(within(sheet).getByTestId('back-amount'), '2');
    await user.click(within(sheet).getByTestId('back-next'));
    await user.click(within(sheet).getByTestId('back-next'));
    expect(sheet).toHaveAttribute('data-step', 'confirm');
    expect(within(sheet).getByText(/Connect a Solana wallet on devnet/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Connect wallet' })).toBeInTheDocument();
  });
});

describe('PositionCard', () => {
  const arena = fixture('bonk-vs-tslax');
  const base: PositionRecord = {
    id: 'demo-1',
    provenance: 'demo',
    arenaSlug: arena.slug,
    arenaId: arena.id,
    side: 'b',
    units: 1,
    entryTs: NOW - 6 * 3600,
    usdAtEntry: 360,
    feeUsd: 1.8,
    multiplierAtEntry: 1.4,
    status: 'active',
  };

  it('keeps "your asset" and "Arena result" apart: TSLAx up, but trailing BONK', () => {
    render(
      <TooltipProvider>
        <PositionCard position={base} arena={arena} now={NOW} />
      </TooltipProvider>,
    );
    const card = screen.getByTestId('position-card');
    expect(within(card).getByText('Your TSLAx')).toBeInTheDocument();
    expect(within(card).getByText(/^\+\d+\.\d{2}%$/)).toBeInTheDocument(); // asset up since entry
    expect(within(card).getByText('Arena result')).toBeInTheDocument();
    expect(within(card).getByText(/TSLAx trails by \d+\.\d{2}%/)).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: /Exit position|Withdraw/ }),
    ).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /DEMO data/ })).toBeInTheDocument();
  });

  it('offers Claim on a won, settled Arena and marks Victory Roll as not yet available', () => {
    const settled = fixture('bonk-vs-tslax-round-1');
    const won: PositionRecord = {
      ...base,
      arenaSlug: settled.slug,
      arenaId: settled.id,
      side: settled.winner as 'a' | 'b',
      entryTs: settled.startTs,
    };
    render(
      <TooltipProvider>
        <PositionCard position={won} arena={settled} now={NOW} />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('claim')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Victory Roll/ })).toBeDisabled();
    expect(screen.getByText(/won$/)).toBeInTheDocument();
  });

  it('shows the exited state with forfeited rewards', () => {
    render(
      <TooltipProvider>
        <PositionCard
          position={{ ...base, status: 'exited', forfeited: true }}
          arena={arena}
          now={NOW}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText(/Exited early — Arena Rewards forfeited/)).toBeInTheDocument();
    expect(screen.queryByTestId('exit')).not.toBeInTheDocument();
  });
});

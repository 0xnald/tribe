// @vitest-environment jsdom
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FIXTURE_DEFS, buildFixtureArena } from '@/lib/arena/fixtures';
import type { ArenaView } from '@/lib/arena/model';
import { getPendingBack, setPendingBack, type PendingBack } from '@/lib/back/pending';
import { buildPreview } from '@/lib/back/preview';
import { JUPITER_V6 } from '@/lib/protocol/verify';

import { TwoStepBack } from '../back/TwoStepBack';

/**
 * Two-step Buy → Back with a mock wallet and mocked RPC/API. Exercises the
 * recovery contract: the Back only ever uses the measured balance delta,
 * a cancelled Back keeps the pending record and offers "Retry Back", and
 * a second buy is never issued.
 */
// jsdom installs its own realm's typed arrays as globals; web3.js and tweetnacl
// check `instanceof Uint8Array` against the global at call time, so signing
// and serialising need Node's constructor back.
vi.stubGlobal('Uint8Array', Object.getPrototypeOf(Buffer.prototype).constructor);

const OWNER = Keypair.generate();
const ARENA_PDA = Keypair.generate().publicKey.toBase58();
const PROGRAM = 'shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4';
const BLOCKHASH = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi';

const walletMock = {
  publicKey: OWNER.publicKey as PublicKey | null,
  signTransaction: vi.fn(),
};
vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => walletMock,
}));

function arena(): ArenaView {
  const a = buildFixtureArena(
    FIXTURE_DEFS.find((d) => d.slug === 'bonk-vs-tslax')!,
    1_789_300_000,
  );
  return {
    ...a,
    provenance: 'onchain',
    onchain: { arena: ARENA_PDA, creator: OWNER.publicKey.toBase58(), nonce: '1' },
  };
}

/** What `/api/market/swap` would return: a v0 transaction paid by the owner routing through Jupiter. */
function swapResponse(): string {
  const ix = new TransactionInstruction({
    programId: new PublicKey(JUPITER_V6),
    keys: [{ pubkey: OWNER.publicKey, isSigner: true, isWritable: true }],
    data: Buffer.from([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a]),
  });
  const msg = new TransactionMessage({
    payerKey: OWNER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [ix],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}

/** What `/api/protocol/back` would return: a legacy transaction with one Tribe instruction. */
function backResponse(): string {
  const tx = new Transaction({ feePayer: OWNER.publicKey, recentBlockhash: BLOCKHASH });
  tx.add(
    new TransactionInstruction({
      programId: new PublicKey(PROGRAM),
      keys: [
        { pubkey: new PublicKey(ARENA_PDA), isSigner: false, isWritable: true },
        { pubkey: OWNER.publicKey, isSigner: true, isWritable: true },
      ],
      data: Buffer.from([1, 2, 3]),
    }),
  );
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

interface Rpc {
  /** Raw token balance returned by successive `getParsedTokenAccountsByOwner` calls. */
  balances: string[];
  sent: Uint8Array[];
}

function mockRpc(): Rpc {
  const rpc: Rpc = { balances: [], sent: [] };
  vi.spyOn(Connection.prototype, 'getParsedTokenAccountsByOwner').mockImplementation(async () => {
    const amount = rpc.balances.shift() ?? '0';
    return {
      context: { slot: 1 },
      value: [
        {
          pubkey: OWNER.publicKey,
          account: {
            data: { parsed: { info: { tokenAmount: { amount } } } },
          },
        },
      ],
    } as never;
  });
  vi.spyOn(Connection.prototype, 'getAddressLookupTable').mockResolvedValue({
    context: { slot: 1 },
    value: null,
  } as never);
  vi.spyOn(Connection.prototype, 'sendRawTransaction').mockImplementation(async (raw) => {
    rpc.sent.push(raw as Uint8Array);
    return `sig${rpc.sent.length}`;
  });
  vi.spyOn(Connection.prototype, 'getLatestBlockhash').mockResolvedValue({
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 100,
  });
  vi.spyOn(Connection.prototype, 'confirmTransaction').mockResolvedValue({
    context: { slot: 1 },
    value: { err: null },
  } as never);
  return rpc;
}

function mockApi() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      if (url === '/api/market/swap') {
        return new Response(
          JSON.stringify({
            swapTransaction: swapResponse(),
            lastValidBlockHeight: 100,
            quote: {
              outAmount: '1000000',
              otherAmountThreshold: '995000',
              routeLabel: 'Raydium',
              slippageBps: 50,
            },
          }),
          { status: 200 },
        );
      }
      if (url === '/api/protocol/back') {
        return new Response(JSON.stringify({ tx: backResponse(), feeUsdc: '50000' }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ data: null }), { status: 200 });
    }),
  );
  return calls;
}

function signWith(kp: Keypair) {
  return async (tx: Transaction | VersionedTransaction) => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
}

const a = arena();
const preview = buildPreview({
  arena: a,
  side: 'a',
  method: 'usdc',
  amount: 10,
  now: 1_789_300_000,
});

beforeEach(() => {
  window.localStorage.clear();
  walletMock.publicKey = OWNER.publicKey;
  walletMock.signTransaction = vi.fn(signWith(OWNER));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TwoStepBack', () => {
  it('buys, measures the balance delta, then backs exactly the received units', async () => {
    const user = userEvent.setup();
    const rpc = mockRpc();
    rpc.balances = ['250000', '1250000']; // +10.00000 BONK (5 decimals) after the swap
    const api = mockApi();
    const onDone = vi.fn();
    render(<TwoStepBack arena={a} side="a" preview={preview} pending={null} onDone={onDone} />);

    const box = screen.getByTestId('two-step');
    expect(within(box).getByText(/two transactions/)).toBeInTheDocument();
    expect(within(box).getByText(/not atomic/)).toBeInTheDocument();
    await user.click(within(box).getByTestId('two-step-buy'));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const [record, sig] = onDone.mock.calls[0] as [Record<string, unknown>, string];
    expect(sig).toBe('sig2');
    expect(record).toMatchObject({ provenance: 'onchain', side: 'a', units: 10, txSig: 'sig2' });

    // the Back request carried the measured delta, not the quote
    const backCall = api.find((c) => c.url === '/api/protocol/back');
    expect(backCall?.body).toMatchObject({ arena: ARENA_PDA, side: 'a', units: 10 });
    expect(api.filter((c) => c.url === '/api/market/swap')).toHaveLength(1);
    expect(walletMock.signTransaction).toHaveBeenCalledTimes(2);
    expect(rpc.sent).toHaveLength(2);
    expect(getPendingBack(a.id, 'a')).toBeNull();
    expect(within(box).getByText(/Received 10 BONK/)).toBeInTheDocument();
  });

  it('keeps the pending record and offers Retry Back (no re-buy) when the Back is cancelled', async () => {
    const user = userEvent.setup();
    const rpc = mockRpc();
    rpc.balances = ['0', '400000'];
    const api = mockApi();
    const onDone = vi.fn();
    let signs = 0;
    walletMock.signTransaction = vi.fn(async (tx: Transaction | VersionedTransaction) => {
      signs += 1;
      if (signs === 2) throw new Error('User rejected the request');
      return signWith(OWNER)(tx);
    });
    render(<TwoStepBack arena={a} side="a" preview={preview} pending={null} onDone={onDone} />);
    const box = screen.getByTestId('two-step');
    await user.click(within(box).getByTestId('two-step-buy'));

    await waitFor(() => expect(within(box).getByText('Back not completed')).toBeInTheDocument());
    expect(
      within(box).getByText(/Your BONK is in your wallet — retry the Back/),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    // the buy is recorded and can never be repeated from this UI
    const pending = getPendingBack(a.id, 'a');
    expect(pending).toMatchObject({ arenaId: a.id, side: 'a', receivedUnits: 4, swapSig: 'sig1' });
    expect(within(box).queryByTestId('two-step-buy')).not.toBeInTheDocument();
    const retry = within(box).getByTestId('two-step-back');
    expect(retry).toHaveTextContent('2. Back 4 BONK (sign) — no re-buy');

    // retry runs only transaction 2
    await user.click(retry);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.filter((c) => c.url === '/api/market/swap')).toHaveLength(1);
    expect(api.filter((c) => c.url === '/api/protocol/back')).toHaveLength(2);
    expect(rpc.sent).toHaveLength(2); // one swap, one back
    expect(getPendingBack(a.id, 'a')).toBeNull();
    expect((onDone.mock.calls[0] as [Record<string, unknown>])[0]).toMatchObject({ units: 4 });
  });

  it('refuses a swap it cannot verify and buys nothing', async () => {
    const user = userEvent.setup();
    const rpc = mockRpc();
    rpc.balances = ['0', '0'];
    mockApi();
    // a swap whose fee payer is someone else must never reach the wallet
    const other = Keypair.generate();
    const msg = new TransactionMessage({
      payerKey: other.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: [],
    }).compileToV0Message();
    const bad = Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ swapTransaction: bad, lastValidBlockHeight: 1, quote: {} }), {
          status: 200,
        }),
    );
    render(<TwoStepBack arena={a} side="a" preview={preview} pending={null} onDone={vi.fn()} />);
    const box = screen.getByTestId('two-step');
    await user.click(within(box).getByTestId('two-step-buy'));
    await waitFor(() => expect(within(box).getByText('Buy not completed')).toBeInTheDocument());
    expect(within(box).getByText(/swap fee payer is not your wallet/)).toBeInTheDocument();
    expect(walletMock.signTransaction).not.toHaveBeenCalled();
    expect(rpc.sent).toHaveLength(0);
    expect(getPendingBack(a.id, 'a')).toBeNull();
    expect(within(box).getByTestId('two-step-buy')).toBeInTheDocument();
  });

  it('resumes at step 2 from a stored pending buy after a reload', async () => {
    const user = userEvent.setup();
    const rpc = mockRpc();
    const api = mockApi();
    const onDone = vi.fn();
    const rec: PendingBack = {
      arenaId: a.id,
      side: 'a',
      mint: a.sides[0].asset.mint,
      symbol: 'BONK',
      receivedUnits: 7.5,
      swapSig: 'oldswap',
      usdcSpent: 10,
      createdAt: 1_789_300_000,
    };
    setPendingBack(rec);
    render(
      <TwoStepBack
        arena={a}
        side="a"
        preview={preview}
        pending={getPendingBack(a.id, 'a')}
        onDone={onDone}
      />,
    );
    const box = screen.getByTestId('two-step');
    expect(within(box).queryByTestId('two-step-buy')).not.toBeInTheDocument();
    expect(within(box).getByText(/Received 7.5 BONK/)).toBeInTheDocument();
    expect(within(box).getByText(/oldswap/)).toBeInTheDocument();
    await user.click(within(box).getByTestId('two-step-back'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(api.filter((c) => c.url === '/api/market/swap')).toHaveLength(0);
    expect(api.find((c) => c.url === '/api/protocol/back')?.body).toMatchObject({ units: 7.5 });
    expect(rpc.sent).toHaveLength(1);
    expect((onDone.mock.calls[0] as [Record<string, unknown>])[0]).toMatchObject({
      units: 7.5,
      usdAtEntry: 10,
    });
    expect(getPendingBack(a.id, 'a')).toBeNull();
  });
});

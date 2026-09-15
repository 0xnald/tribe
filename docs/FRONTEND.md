# Tribe — Frontend (Phase 3)

> The consumer app in `apps/web`: Explore, Arena, Back flow, My Arenas.
> Source of truth for how the UI is wired to markets and to the protocol.

## 1. Hybrid network architecture

Tribe runs two layers on two clusters during the hackathon, and the UI
never pretends otherwise:

| Layer        | Cluster      | What comes from it                                                                                               | Config                                                                                       |
| ------------ | ------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Market**   | mainnet-beta | prices, 24 h move, liquidity (Jupiter Price v3), market status (xStocks, Pyth), logos, wallet balances, quotes   | `NEXT_PUBLIC_MARKET_CLUSTER`, `NEXT_PUBLIC_MARKET_RPC_URL`                                   |
| **Protocol** | devnet       | the `tribe_arena` program: config, Arenas, positions, transactions; devnet Pyth feeds for live Arena performance | `NEXT_PUBLIC_TRIBE_PROTOCOL_CLUSTER`, `NEXT_PUBLIC_TRIBE_PROTOCOL_RPC_URL`, `..._PROGRAM_ID` |

`lib/config/network.ts` is the only place a cluster is named. Switching the
protocol to mainnet later is a config change
(`NEXT_PUBLIC_TRIBE_PROTOCOL_CLUSTER=mainnet-beta` plus the mainnet program
id), not a UI rewrite.

### Provenance

Every Arena, price and position carries one of three labels, rendered as a
compact badge (`ProvenanceBadge`) with a tooltip — never a banner:

- **LIVE** — mainnet market data (Jupiter / xStocks / Pyth). Shown on market
  panels and the nav status pill (`LIVE MARKETS · DEVNET PROTOCOL`).
- **DEVNET** — real on-chain state on the devnet program. Devnet test tokens
  (`tBONK`, `tSOL`) stand in for the mainnet assets and are named as such;
  their Arena performance comes from Pyth's sponsored devnet feeds (the same
  feed ids mainnet would use).
- **DEMO** — fixture Arena: simulated Arena prices and backing for
  presentation. Every Back step says "no transaction". Demo positions are
  stored on the device only.

A failed LIVE request is labelled `unavailable` or `stale`; it is never
replaced by demo numbers.

## 2. Routes

| Route                                 | Rendering                           | Purpose                                                                                          |
| ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/`                                   | server (dynamic) + client `Explore` | featured Arena hero, filters, feed, narratives, "How Tribe works"                                |
| `/arena/[slug]`                       | server + client `ArenaDetail`       | hero, relative-performance chart, markets, activity, rewards, details, share; OG image per Arena |
| `/my-arenas`                          | server + client `MyArenas`          | Active / Claimable / Completed / Exited positions (demo on-device + devnet on-chain)             |
| `/create`                             | static                              | creator placeholder listing supported matchups                                                   |
| `/api/arenas`                         | JSON                                | all Arenas (devnet + fixtures) with market context; polled by the feed                           |
| `/api/arenas/[slug]`                  | JSON                                | one Arena; polled by the Arena page                                                              |
| `/api/protocol`                       | JSON                                | program/config verification on the protocol cluster                                              |
| `/api/protocol/back` `/exit` `/claim` | JSON (POST)                         | unsigned transactions built with `@tribe/program-client`; the wallet signs client-side           |
| `/api/positions`                      | JSON                                | on-chain positions for a wallet                                                                  |
| `/api/market/quote`                   | JSON                                | indicative Jupiter USDC→asset quote (mainnet)                                                    |
| `/api/logo/[mint]`                    | image                               | cached logo proxy (registry → Jupiter icon → token-list)                                         |
| `/api/devnet/faucet`                  | JSON                                | devnet test-token drip (only when `DEVNET_FAUCET_KEYPAIR` is configured)                         |

Slugs: fixture Arenas use readable slugs (`bonk-vs-tslax`); devnet Arenas use
`devnet-<arena address>`. Deep links work directly.

## 3. Data flow

```
Jupiter / xStocks / Pyth ──▶ lib/market/*  (server-only, TTL cache, SWR)
                                   │
fixtures (lib/arena/fixtures) ─────┼──▶ lib/arena/repo.listArenas / getArena ──▶ page (server) ──▶ client
                                   │                                              ▲
devnet program (lib/protocol) ─────┘                                  /api/arenas polling (10–20 s, visible tab only)
```

- Pages render on the server with the current clock (`serverNow`) and hand
  the initial `ArenaView[]` to a client component; `useNow` ticks the
  countdowns; `useLive*` polls the JSON routes while the tab is visible.
- `lib/market/cache.ts` keeps one in-memory TTL cache per server with
  stale-while-revalidate; a value is only marked `stale` after refreshes have
  failed for 3× the TTL.
- Protocol reads use `disableRetryOnRateLimit` and a 4–6 s hard timeout so
  the public devnet RPC can never block a page.

## 4. Fixture engine

`lib/arena/fixtures.ts` builds demo Arenas as pure functions of
(definition, clock): seeded performance paths (ease-out drift toward a
target plus layered noise), rolling 24 h–7 d schedules with a short gap,
backing/participants that grow with elapsed time, generated activity
(backs, lead changes, sponsor, cutoff), and 120-point history. Same clock →
same numbers (tested), so screenshots and tests are stable while the demo
still moves in real time. State demos exist for scheduled, settled and
cancelled Arenas.

## 5. Back flow

`components/back/BackSheet.tsx` — side → funding method → amount → preview →
confirm → success. Fees and multipliers use the `@tribe/core` engine
(`feeRequired`, underdog policy). Estimates are labelled estimates.

- Demo Arena: both funding paths are shown (USDC via a real indicative
  Jupiter mainnet quote, or existing mainnet holdings), the confirm step
  simulates the transaction states and saves a DEMO position on the device.
- Devnet Arena: only "existing holdings" (devnet test tokens); the sheet
  offers the faucet; `/api/protocol/back` builds `open_position + back`,
  the wallet signs, the app confirms and links the explorer. A devnet Back
  also needs a little devnet USDC for the 0.50 % fee (Circle's devnet
  faucet) — the sheet says so.
- Mainnet Arena, "Buy with USDC — two transactions"
  (`components/back/TwoStepBack.tsx`): never presented as one action.
  1. **Buy** — `/api/market/swap` builds a Jupiter swap (keyless lite-api
     `swap/v1/quote` + `swap/v1/swap`, USDC → asset, slippage 50 bps,
     min-out from the route). The client resolves the transaction's lookup
     tables, runs `verifyJupiterSwap` (fee payer = wallet, one signer, only
     Jupiter v6 / token / ATA / system / compute-budget programs), the
     wallet signs, the app sends on the market RPC and waits for
     `confirmed`. The received amount is the **token-balance delta**
     measured after confirmation, never the quote.
  2. **Back** — `/api/protocol/back` is called with exactly the received
     units; `verifyTribeTransaction` checks it before the second signature.
  - A `PendingBack` record (`lib/back/pending.ts`, localStorage
    `tribe.pendingBack.v1`) is written the moment the buy confirms and
    cleared only when the Back confirms. If the Back is cancelled or fails,
    the sheet shows "Back not completed", the asset stays in the wallet and
    the only button is "2. Back … (sign) — no re-buy". Reopening the sheet
    for that Arena/side resumes at step 2. A second buy cannot be issued
    while a record exists. Covered by `components/__tests__/two-step.test.tsx`.
- Native SOL side (`So111…112`): "Use SOL from your wallet". The balance
  shown is wSOL held + SOL minus a 0.02 SOL fee reserve. The Back
  transaction wraps the shortfall itself (create wSOL ATA idempotently,
  `SystemProgram.transfer`, `syncNative`) before `open_position + back`;
  the intent check allows only that transfer (owner → owner's wSOL ATA)
  and that `syncNative`. Exit returns wSOL to the owner's ATA and, with
  `unwrap: true`, closes it so plain SOL comes back
  (`closeAccount` wSOL ATA → owner, also whitelisted).
- The wallet is requested only at the confirm step. Wallet discovery is
  Wallet-Standard (`wallets={[]}`), nothing hard-coded.

## 6. My Arenas

Each card keeps two numbers apart: **Your asset** (price move since entry)
and **Arena result** (your side vs the other side since Arena start). A
losing Arena does not mean the asset lost. Buckets: Active, Claimable,
Completed, Exited. Exit / Claim work for demo (device) and devnet
(transactions). Victory Roll is shown disabled until Phase 4.

## 7. Devnet demo setup

`packages/program-client/tests/devnet-setup.test.ts` (env-gated) created the
stand-in mints, registered them with the real Pyth BONK/SOL feed ids, opened
a 24 h Arena and ran `snapshot_start` against the devnet feeds. The mints
are the built-in defaults in `lib/protocol/devnet-assets.ts` and can be
overridden with `NEXT_PUBLIC_DEVNET_ASSETS`. `DEVNET_FAUCET_KEYPAIR`
(server-side, mint authority) enables the faucet.

## 8. Local development

```bash
pnpm install
cp .env.example apps/web/.env.local     # optional; defaults work keyless
pnpm dev                                 # http://localhost:3000
pnpm --filter @tribe/web test            # vitest (lib + components, jsdom)
pnpm --filter @tribe/web test:e2e        # Playwright core paths (builds/starts on :3100)
pnpm --filter @tribe/web shots           # screenshots of every page at every target viewport
```

`NEXT_PUBLIC_TRIBE_MODE=demo` renders fixtures only (no external calls).

## 9. Accessibility and performance notes

- Radix dialogs/tooltips/popovers (focus trap, Escape, labels); visible
  focus rings; live regions for countdowns (throttled) and transaction
  states; colour never the only carrier (sign + arrow on every percentage,
  names on every bar, text on every status).
- `prefers-reduced-motion` removes pulses, sweeps and sheet motion.
- Server components fetch; client components are limited to interactive
  areas; the Back sheet is `next/dynamic`; charts are hand-rolled SVG (no
  chart library); logos go through a cached proxy; polling pauses in hidden
  tabs.

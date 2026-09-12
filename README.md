<p align="center">
  <img src="docs/assets/tribe-wordmark.svg" alt="Tribe" width="220" />
</p>

<h1 align="center">Tribe</h1>

<p align="center"><strong>Don't bet on what you believe in. Own it.</strong></p>

<p align="center">
  A competitive ownership layer for markets on Solana.<br/>
  Built for the Solana Foundation <a href="https://x.com/solana/status/2098403597004263760">Stocklana</a> hackathon.
</p>

---

## What Tribe is

Tribe puts two real assets in an **Arena** — BONK vs TSLAx, SOL vs SPYx,
GLDx vs BTC — and lets you **Back** the one you believe in for a fixed time
window.

When you back BONK with 100 USDC, your USDC is swapped into **actual BONK**
that you own. The Arena compares each side's percentage move from the
start. The winning side shares an **Arena Reward Pool** funded by fees and
sponsors, weighted by how much you backed, how long you held, and whether
you backed the underdog.

**Tribe is not a prediction market.** Losing an Arena never transfers your
principal to anyone. Your BONK is still your BONK: keep it, sell it, or
roll it into the next Arena.

| You back BONK with $100 | BONK | TSLAx | Arena | Your BONK is worth | Arena Rewards |
| --- | --- | --- | --- | --- | --- |
| | +15% | +2% | BONK wins | ≈ $115 | your share of the pool |
| | +5% | +9% | BONK loses | ≈ $105 | none |
| | −10% | −12% | BONK wins | ≈ $90 | your share of the pool |

## How it works

1. **Back** a side with USDC (routed through Jupiter into the asset) or
   with an asset balance you already hold.
2. **Own** it. Your units sit in an Arena Position Vault only you can
   withdraw from — the program has no other path for your tokens.
3. **Hold** your conviction. Reward weight is the integral of capital over
   time; backing closes before the end so nobody can snipe.
4. **Earn** if your side wins: `capital × time held × underdog multiplier`
   decides your share of the pool. Then **Victory Roll** it into more of the
   asset or the next Arena.

Details: [PRODUCT](docs/PRODUCT.md) · [ECONOMICS](docs/ECONOMICS.md) ·
[ARENA_STATE_MACHINE](docs/ARENA_STATE_MACHINE.md).

## Why Solana

Tokenized stocks (xStocks) and Solana memes share one wallet, one settlement
layer, one router. "BONK vs TSLAx" can only exist here:

- **xStocks** are Token-2022 assets with on-chain rebasing multipliers and
  Pyth/Chainlink oracle mappings — Tribe reads the multiplier straight from
  the mint so splits and dividends are price-continuous.
- **Jupiter** routes USDC into either side and returns composable
  instructions, so *swap + back* is one signature.
- **Pyth** pull oracles let the program verify crypto **and** US-equity
  settlement prices at exact timestamps — anyone can settle an Arena and
  get the same answer.

## Architecture

```
Next.js 16 app ──▶ API routes (Jupiter, Pyth proxy, registry, OG cards)
       │                 │
       │ wallet txs      │ crank + indexer
       ▼                 ▼
 tribe_arena (Anchor 1.2) ◀── Pyth receiver ── Pyth Hermes
   Arena · Position vaults (Token-2022 aware) · Reward pool · Registry
```

- **On-chain**: Arena state, position vaults, time-weighted accumulators,
  reward pool, sponsor deposits, Pyth-verified settlement, claims,
  permissionless start / settle / cancel-on-expiry.
- **Off-chain**: indexer (Postgres), crank, price SSE, market-quality
  scoring, leaderboards, Conviction Score, social cards.
- **Custody model**: per-user Arena Position Vault with user-only
  withdrawal — chosen over delegation and balance snapshots because it is
  the only option that lets Tribe *honestly* attest holding duration. See
  [ARCHITECTURE](docs/ARCHITECTURE.md#4-custody-and-holding-verification).

Full document: [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[SECURITY](docs/SECURITY.md) · [DESIGN_SYSTEM](docs/DESIGN_SYSTEM.md).

## Integrations

| | Used for |
| --- | --- |
| [xStocks public API](https://docs.xstocks.fi/apis/openapi) | asset list, mints, market status, multipliers, corporate actions, oracle mapping |
| [Jupiter](https://developers.jup.ag) | quotes (`swap/v2/order`), composable swap instructions (`swap/v2/build`), Price v3, Tokens v2 (organic-volume and verification signals) |
| [Pyth](https://docs.pyth.network) | settlement and display prices; `PriceUpdateV2` verified on-chain via the Pyth Solana receiver |
| Token-2022 | xStocks `ScaledUiAmount`, `pausable`, `permanentDelegate` handling via `token_interface` |
| [DN Institute wash-trading study](https://github.com/mkzung/solana-xstocks-wash-analysis) | methodology for the market-quality layer |

## Screenshots

_Placeholders — captured in Phase 3 (Home, Arena, Back flow, My Arenas) into `docs/assets/screens/`._

## Repository

```
apps/web/                 Next.js app (UI, API routes, crank, indexer)
packages/core/            Pure TypeScript domain logic + shared test vectors
packages/program-client/  Generated IDL types and transaction builders
programs/tribe_arena/     Anchor program and tests
docs/                     Source-of-truth documents
scripts/                  Registry sync, seeding, crank runner
```

## Local setup

Requirements: Node 22, pnpm 12 (`corepack enable`), and for the program:
Rust, Agave CLI 4.2, Anchor 1.2 (built in WSL on Windows).

```bash
pnpm install
cp .env.example .env.local        # fill in keys (see below)
pnpm dev                          # http://localhost:3000 (demo mode by default)
```

Program:

```bash
cd programs/tribe_arena
anchor build && anchor test
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `mainnet-beta` or `devnet` |
| `NEXT_PUBLIC_RPC_URL` / `RPC_URL` | browser / server RPC endpoints |
| `NEXT_PUBLIC_TRIBE_PROGRAM_ID` | deployed `tribe_arena` id |
| `TRIBE_MODE` | `live` or `demo` |
| `PYTH_HERMES_URL`, `PYTH_HERMES_API_KEY` | Pyth Hermes (API key required since Aug 2026) |
| `JUPITER_API_KEY` | Jupiter APIs |
| `XSTOCKS_API_URL` | defaults to `https://api.xstocks.fi/api/v2` |
| `DATABASE_URL` | Postgres; empty uses embedded PGlite |
| `CRANK_KEYPAIR` | base58 keypair for start/settle cranks (fee SOL only) |
| `HELIUS_WEBHOOK_SECRET` | indexer webhook auth |
| `NEXT_PUBLIC_APP_URL` | absolute URL for share links and OG images |

## Testing

```bash
pnpm lint          # ESLint + Prettier check
pnpm typecheck     # tsc --noEmit across the workspace
pnpm test          # Vitest: reward math, state machine, oracle policy, manipulation cases
pnpm test:e2e      # Playwright responsive checks (Phase 3+)
anchor test        # program integration tests (Phase 2+)
```

The economics have shared test vectors used by both TypeScript and Rust
(`packages/core/src/__fixtures__`), so the two implementations are checked
for bit-for-bit agreement.

## Demo mode vs live mode

Tribe never presents simulated behaviour as real. Every Arena and position
carries a provenance badge — **LIVE** (on-chain, real prices, real
transactions), **DEMO** (seeded, simulated prices, no transactions), or
**FIXTURE**. `TRIBE_MODE=demo` runs the full UI without any external API.

## Status

Phase 0 (architecture and product lock) complete. See
[STOCKLANA_PLAN](docs/STOCKLANA_PLAN.md) for phases, the demo script, and
open decisions. Known limitations are listed in
[SECURITY §6](docs/SECURITY.md#6-known-limitations-documented-in-readme).

## Hackathon context

Stocklana, Solana Foundation — *"Tokenized stocks already trade on Solana.
Build what makes owning and using them better than today's brokerage
app."* Tribe's wedge: **Consumer** — a social reason to own tokenized
stocks and memes side by side, with real ownership at the core.

Open-source components: Anchor, Pyth SDKs, Jupiter APIs, Radix UI, Motion,
Tailwind, Drizzle, and others listed in `package.json`. All Tribe code is MIT
licensed.

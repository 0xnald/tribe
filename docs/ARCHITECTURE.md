# Tribe — Architecture

> **Status:** Source of truth for system boundaries, custody model, oracle
> policy, integrations and the technology stack. Research facts behind these
> decisions (verified 2026-09-12) are in [RESEARCH_NOTES.md](./RESEARCH_NOTES.md).

---

## 1. System overview

```
┌──────────────────────────────── Browser ────────────────────────────────┐
│  Next.js 16 app (React 19, Tailwind 4, Motion)                          │
│  Wallet Adapter (Phantom, Solflare, Backpack, …)                        │
│  • composes & signs txs: [fee + Jupiter swap + back] / exit / claim     │
└───────────────┬───────────────────────────────────────┬─────────────────┘
                │ HTTPS (Route Handlers)                │ RPC (Helius)
                ▼                                       ▼
┌──────────────────────────── apps/web server ──────────────┐   ┌──────────────────────┐
│ /api/arenas, /api/positions, /api/leaderboard             │   │  Solana mainnet-beta │
│ /api/quote      → Jupiter swap/v2/order (no taker)        │   │                      │
│ /api/tx/back    → Jupiter swap/v2/build + program ixs     │   │  tribe_arena program │
│ /api/oracle     → Pyth Hermes (server-side API key)       │   │  (Anchor 1.2)        │
│ /api/assets     → registry + xStocks + Jupiter tokens v2  │   │  ├ Arena / Position  │
│ /api/og/[arena] → social card (ImageResponse)             │   │  ├ vaults (Token-2022)│
│ crank: snapshot_start / settle / sweep (Vercel cron)      │◀──│  └ events            │
│ indexer: program logs → Postgres (Drizzle)                │   │  Pyth receiver       │
└───────────────────────────────────────────────────────────┘   └──────────────────────┘
                │
                ▼
      ┌──────────────────┐        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
      │ Postgres (Neon)  │        │ Pyth Hermes  │  │ Jupiter APIs │  │ xStocks API  │
      │ PGlite locally   │        │ (API key)    │  │ (API key)    │  │ (public)     │
      └──────────────────┘        └──────────────┘  └──────────────┘  └──────────────┘
```

`packages/core` holds all financial logic as pure TypeScript with shared test
vectors; the program is the on-chain twin of that logic.

## 2. Repository layout (monorepo, pnpm workspaces)

```
tribe/
├─ apps/web/                 Next.js app (UI, API routes, crank, indexer, OG cards)
├─ packages/core/            Pure TS domain: fixed-point math, reward engine,
│                            state machine, asset registry types, oracle policy,
│                            config schemas, shared test vectors
├─ packages/program-client/  Generated IDL types + tx builders for tribe_arena
├─ programs/tribe_arena/     Anchor program (Rust) + tests
├─ docs/                     Source-of-truth documents
└─ scripts/                  Registry sync, seed arenas, crank runner
```

## 3. On-chain vs. off-chain

| Concern                                                            | Where                                                   | Why                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Arena parameters & state                                           | **On-chain**                                            | Auditable, permissionless lifecycle, no trust in Tribe servers for outcomes.          |
| Position vaults & accumulators                                     | **On-chain**                                            | Holding verification and time weighting must be enforceable; ECONOMICS §5.            |
| Reward pool, sponsor deposits, fee routing                         | **On-chain**                                            | Solvency by construction; sponsors can verify funding.                                |
| Settlement prices                                                  | **On-chain** (Pyth `PriceUpdateV2` verified in-program) | Removes the Tribe crank from the trust base — anyone can settle with the same result. |
| Claims                                                             | **On-chain**                                            | Double-claim safety via PDA flag.                                                     |
| Asset registry (eligibility)                                       | **On-chain** allowlist, **off-chain** scoring           | Program needs a small trustworthy list; the market-quality model needs rich data.     |
| Participant counts, activity feeds, leaderboards, Conviction Score | **Off-chain** indexer                                   | Derived deterministically from events; cheap to recompute.                            |
| Display prices, quotes, routes                                     | **Off-chain**                                           | Latency and cost; never used for settlement.                                          |
| Social cards, deep links, drafts                                   | **Off-chain**                                           | Pure presentation.                                                                    |

What is deliberately **not** built on-chain in the MVP: the market-quality
scoring model, Conviction Score, leaderboards, streak logic. They influence
nothing that moves funds.

## 4. Custody and holding verification

Reward eligibility requires knowing a user _held_ the asset for the accrued
time. Four models were compared:

| Option                                                                            | Holding provable?                                                   | Principal safety                                       | Token-2022 fit                                                        | Complexity     | Verdict                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| **1. Arena Position Vault** (per-user PDA token account; only owner can withdraw) | Yes, on-chain                                                       | Program has no path to move funds except back to owner | Good — `transfer_checked` via token interface; ATA handles extensions | Small program  | **Chosen**                                                  |
| 2. Token delegation (`approve` to Arena PDA)                                      | No — user can still transfer the delegated balance away             | Same as wallet                                         | OK                                                                    | Small          | Rejected: cannot honestly claim "held throughout"           |
| 3. Balance snapshots / indexer                                                    | No — sampling can be gamed between samples; indexer must be trusted | Same as wallet                                         | OK                                                                    | Medium + infra | Rejected as primary; kept as an _observability_ signal only |
| 4. Position receipt token (transferable NFT/token)                                | Yes                                                                 | Same as 1                                              | Adds a mint per position                                              | Larger         | Post-MVP idea (secondary market for positions)              |

**Decision: Option 1 — Arena Position Vault.**

- The vault is an associated token account owned by the `Position` PDA
  `["position", arena, side, user]`. The program's only transfer-out
  instruction (`exit`) requires the user's signature and transfers to the
  user's own token account. There is no admin withdrawal path, no
  `permanent_delegate` set by Tribe, and no upgrade authority in production
  (the program is frozen after the audit-readiness milestone; during the
  hackathon it is upgradeable and documented as such).
- The user therefore keeps **economic ownership** and **sole withdrawal
  authority** of the asset for the entire Arena, and the program can
  truthfully attest holding duration.
- Honest limitation: units in the vault are not in the user's wallet UI. The
  Tribe UI shows them as "In Arena" alongside wallet balances. Some issuers'
  Token-2022 extensions (`permanent_delegate`, `pausable`, freeze authority
  on xStocks) apply equally in a wallet and in a vault; Tribe does not add
  new counterparties.

## 5. Reference pricing and oracle policy

### 5.1 Hierarchy

| Purpose                                       | Source                                                                                                                                               | Notes                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Settlement & start snapshots**              | Pyth Core price feeds, posted on-chain as `PriceUpdateV2` and verified by the program                                                                | Feed ids fixed in the registry. Crypto: `Crypto.X/USD`. Equity: `Equity.US.X/USD` × on-chain `ScaledUiAmount` multiplier. |
| **Live Arena display**                        | Pyth Hermes (server proxy, API key) polled every 2–5 s                                                                                               | Same feeds as settlement so the UI never shows a number the program would not.                                            |
| **Display fallback**                          | Jupiter Price v3 (`usdPrice`, `stockData` for xStocks)                                                                                               | Labelled "indicative"; used only if Hermes is unavailable. Never used for settlement.                                     |
| **Market status / halts / corporate actions** | xStocks public API (`/public/assets/{symbol}`, `/system/status`, `/corporate-actions/upcoming`, `/assets/{symbol}/multiplier`) + Pyth `market_hours` | Advisory inputs to the crank and UI.                                                                                      |
| **Execution quotes**                          | Jupiter `swap/v2/order` (no `taker`) for previews; `swap/v2/build` for composable instructions                                                       | Slippage and price impact shown in the Back preview.                                                                      |

### 5.2 Why not the xStocks-specific Pyth feeds

xStocks publishes `TSLAXUSD`-style Pyth feeds for some tokens (Hermes ids in
the xStocks oracle list), but not for all (e.g. GMEx has only a Lazer id;
DISx has no entry). Using the canonical `Equity.US.*` feed × the on-chain
multiplier gives one rule for every xStock, is corporate-action safe by
construction (ECONOMICS §0.1), and avoids depending on feed coverage. The
xStock-specific feeds are recorded in the registry as a secondary reference
for display cross-checks.

### 5.3 On-chain verification rules (program)

For each side at snapshot/settle:

1. `price_update.verification_level == Full`.
2. `price_update.feed_id == registry.feed_id` (exact 32-byte match).
3. `publish_time` inside the window (STATE_MACHINE §3.2/§3.6), i.e.
   `|publish_time − target_ts| ≤ tolerance` (Exact mode) or
   `target_ts − max_closed_staleness ≤ publish_time ≤ target_ts` (LastKnown
   mode, equities only).
4. `conf × 10_000 / price ≤ max_conf_bps`.
5. `price > 0`; exponent normalised to Q8 with overflow checks.
6. For `ScaledUi` assets, `mult_q6` is read from the mint's
   `ScaledUiAmountConfig` (respecting `new_multiplier_effective_timestamp`).

The Pyth Solana receiver program on mainnet is
`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` (verify against the Pyth
docs at implementation time; the id is a config value, not a constant).

### 5.4 Hermes access

Since 2026-08-26 Hermes requires an API key (`Authorization: Bearer`, base
URL `https://pyth.dourolabs.app/hermes`). The key lives server-side only
(`PYTH_HERMES_API_KEY`); the browser talks to `/api/oracle/*`. The crank
uses `GET /v2/updates/price/{publish_time}` to fetch the update **at** a
target timestamp so late settlement uses the right price.

### 5.5 Manipulation protections

- Settlement never reads AMM state; DEX prints cannot move an Arena result.
- Tolerance windows are narrow (60 s crypto, 120 s equity) and anchored to
  `start_ts`/`end_ts`, not to the crank's submission time.
- Confidence gating rejects wide-uncertainty prints.
- Assets need an active registry entry; the registry admission checks are
  in §6.

## 6. Asset eligibility and market quality

Two layers:

**On-chain Asset Registry** (`AssetEntry` PDA per mint, protocol authority):
`mint`, `token_program`, `decimals`, `asset_class` (Crypto | Equity | Etf |
Commodity), `feed_id`, `scaled_ui`, `tolerance_secs`, `max_closed_staleness`,
`max_conf_bps`, `status` (Active | Suspended | Retired). `create_arena`
requires both entries `Active`. Admission additionally rejects mints with a
`transfer_fee` extension or a non-null `transfer_hook` program.

**Off-chain Market Quality Score** (`packages/core/market-quality`), computed
from Jupiter Tokens v2, Jupiter Price v3, xStocks API and, for xStocks, the
DN Institute wash-trading methodology:

| Signal              | Threshold (initial)                                                                                                                                                                 | Source                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Oracle availability | Pyth feed exists and published in last 24 h (or last session for equities)                                                                                                          | Pyth                                                         |
| Liquidity           | ≥ $250k Jupiter-reported liquidity                                                                                                                                                  | Price v3 `liquidity`                                         |
| Market age          | mint `createdAt` ≥ 30 days                                                                                                                                                          | Tokens v2                                                    |
| Organic volume      | Jupiter `organicScore ≥ 40` (and `organicScoreLabel ≠ low`); the organic-volume _ratio_ is only a 1 % sanity floor because Jupiter reports ~1–25 % organic even for SOL and xStocks | Tokens v2                                                    |
| Verification        | Jupiter `isVerified`, no `audit.isSus`                                                                                                                                              | Tokens v2                                                    |
| Issuer status       | not `isTradingHalted`; no unsupported corporate action pending                                                                                                                      | xStocks                                                      |
| Wash signature      | pool-level round-trip share below the DN-Institute flag threshold on the primary route                                                                                              | scheduled job (post-MVP automation; manual for the seed set) |

Only assets passing all gates are proposed for registry activation. The model is
implemented in `packages/core/src/market/quality.ts` (`evaluateAssetQuality` →
`ELIGIBLE | WARNING | REJECTED` with reason codes; thresholds are a config
object) and the seed registry in `packages/core/src/registry/assets.ts`. Because
settlement uses oracle prices, low-liquidity manipulation affects a user's
_execution_ (visible slippage in the preview) but not the Arena result; the
liquidity gate exists to protect execution quality and to keep the
underdog-share signal meaningful.

## 7. Transaction composition

**Back with USDC** — one signature:

```
[compute budget]
[fee: transfer_checked USDC user → reward vault / treasury / creator]   (program: `collect_fee` or inside `back`)
[Jupiter swap/v2/build instructions: setup, swap, cleanup]              (USDC → asset, into user's ATA)
[program `back`: transfer_checked asset user ATA → position vault; accumulators]
+ address lookup tables from Jupiter
```

The program's `back` reads the _actual_ post-swap units from the user's ATA
delta (`units` argument bounded by ATA balance), so slippage never leaves
units stranded. If the composed transaction exceeds 1232 bytes for a given
route, the client falls back to two transactions (swap, then back) and says
so.

**Back with existing holdings** — one signature: `[fee][back]`.

**Exit** — `[exit]`. **Claim** — `[claim]`. **Victory Roll** —
`[claim][swap][back(next arena)]` with the same size fallback.

Jupiter's `/build` is Metis-only; `/order`+`/execute` (all routers, gasless
eligibility) is used for standalone buys that create no position.

## 8. Program design (Anchor 1.2, `tribe_arena`) — implemented in Phase 2

Program id (devnet & local): `shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4`.
Source: `programs/tribe_arena`. The pure engine (`src/engine/*`) is a
line-by-line transcription of `packages/core` and is what the shared
vectors replay; instruction handlers (`src/instructions/*`) add account
validation and token transfers around it.

### 8.1 Accounts

| Account          | Seeds                              | Purpose                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProtocolConfig` | `["config"]`                       | `authority`, `usdc_mint`, `treasury` (USDC token account), `upset_reserve` (USDC ATA of the config PDA), `fee_policy`, `limits`, `default_params`, `paused`.                                                                   |
| `AssetEntry`     | `["asset", mint]`                  | registry (§6): mint, token program, decimals, asset class, Pyth feed id, `scaled_ui`, tolerance, closed-staleness, max confidence, status.                                                                                     |
| `Arena`          | `["arena", creator, nonce_le]`     | both `ArenaAsset` snapshots, window + `backing_close_ts`, params/fee-policy snapshot, creator target, status, start/end `PriceSnapshot`s, `last_accrual_ts`, `[SideState; 2]`, reward-pool accounting, `SettlementRecord`, cancel/extension/sweep metadata. |
| `Position`       | `["position", arena, side, owner]` | ECONOMICS §5.2 state (`units`, `unit_seconds`, `eff_units`, `eff_unit_seconds`, timestamps, `claimed`, `deposits`, `fee_paid`, `forfeited`). Authority of its own vault ATA.                                                    |
| `Sponsor`        | `["sponsor", arena, sponsor]`      | funded amount, refunded flag.                                                                                                                                                                                                   |

Vaults are associated token accounts, never arbitrary accounts:

- **Position vault** — ATA(`position` PDA, side mint, side token program).
  Only `exit` moves tokens out, signed by `owner`, to a token account whose
  authority is `owner`.
- **Reward vault** — ATA(`arena` PDA, USDC). Funded by fee legs, sponsors and
  the Upset Bonus; drained only by `claim` (to the claimant), `refund_sponsor`
  (to the sponsor) and `sweep_unclaimed` (to the treasury).
- **Upset reserve** — ATA(`config` PDA, USDC); `settle` moves at most the
  computed bonus into the reward vault.

Per-pair `Rollover` vaults from Phase 0 are **post-MVP**: `sweep_unclaimed`
sends the remainder to the treasury and records it in `rollover_out`.

### 8.2 Instructions

| Instruction         | Signer    | Guards (engine + accounts)                                                                                                                                                                                                                                                  |
| ------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_config`       | authority | one-time; validates fee split = 100 %, limits, params; creates the upset reserve ATA.                                                                                                                                                                                          |
| `set_asset`         | authority | inspects the mint: owner must equal the supplied token program; Token-2022 mints with `TransferFeeConfig`, `NonTransferable`, `InterestBearingConfig` or a non-null transfer-hook program are rejected; records `scaled_ui`.                                                    |
| `set_paused`        | authority | pauses `create_arena` and `back`.                                                                                                                                                                                                                                             |
| `create_arena`      | anyone    | both `AssetEntry` PDAs must be `Active` (mints cannot be substituted — the entries are derived from the mint), distinct assets, duration/lead/window limits, params snapshot, reward vault ATA init, `backing_close_ts` derived.                                               |
| `fund_reward_pool`  | sponsor   | SCHEDULED/LIVE and before `end_ts`; permissionless when `sponsor_open`, else creator/authority; `Sponsor` record accumulates.                                                                                                                                                  |
| `snapshot_start`    | anyone    | SCHEDULED, `start_ts ≤ now ≤ start_ts + grace`; two `PriceUpdateV2` accounts (owner-checked by the Pyth SDK type) validated per §5.3; mints must match the Arena; ScaledUi multiplier read from the mint.                                                                    |
| `open_position`     | owner     | SCHEDULED/LIVE; idempotently creates the `Position` PDA and its vault ATA for one side (owner/side must match on re-use). Composed by the client in front of the first `back`.                                                                                             |
| `back`              | owner     | LIVE, `now < backing_close_ts`, notional ≥ minimum, `fee_paid ≥ required`; mint/token program must equal the side's registered ones; user token accounts must be owned by `owner`; vault delta checked after the transfer; fee legs (treasury, upset reserve, creator ATA / reward vault) are address-pinned. |
| `exit`              | owner     | any status with positions; forfeiture per ECONOMICS §5.5 while LIVE before `end_ts`; PDA-signed transfer to an account owned by `owner`.                                                                                                                                       |
| `settle`            | anyone    | LIVE, `end_ts ≤ now ≤ deadline`; two validated `PriceUpdateV2`; winner/TIE; whole-Arena TWAB → `m_settle`; Upset Bonus transferred from the reserve; `W_total` frozen.                                                                                                        |
| `claim`             | owner     | SETTLED, winning side, not claimed, `W_i > 0`; `claimed` set before the PDA-signed USDC transfer to an account owned by `owner`.                                                                                                                                               |
| `cancel_arena`      | authority | SCHEDULED/LIVE → CANCELLED.                                                                                                                                                                                                                                                   |
| `cancel_expired`    | anyone    | SCHEDULED past `start_ts + grace`, or LIVE past `end_ts + grace + extension` → CANCELLED.                                                                                                                                                                                     |
| `extend_settlement` | authority | LIVE, after `end_ts`, once, ≤ `max_extension_secs`.                                                                                                                                                                                                                           |
| `refund_sponsor`    | sponsor   | CANCELLED or TIE; once per sponsor; PDA-signed transfer to the sponsor's own USDC account.                                                                                                                                                                                     |
| `sweep_unclaimed`   | anyone    | SETTLED after the claim window; TIE keeps unrefunded sponsor money in the vault.                                                                                                                                                                                              |

Events mirror STATE_MACHINE §3 (`ArenaCreated`, `PoolFunded`, `ArenaStarted`,
`Backed`, `Exited`, `ArenaSettled`, `RewardClaimed`, `ArenaCancelled`,
`SettlementExtended`, `SponsorRefunded`, `UnclaimedSwept`).

### 8.3 Arithmetic and oracle adapter

All arithmetic is checked in `u128`/`i128`; `floor(a × b / d)` uses a
256-bit intermediate (`engine/u256.rs`) so proportional payouts and USD
valuations are exact for any `u64` unit count over a 30-day Arena. The
only floating-point read in the program is the Token-2022 `ScaledUiAmount`
multiplier, which the token program itself stores as an IEEE `f64`; it is
converted once, deterministically, to Q6 and range-checked (`token.rs`).

The oracle path is isolated: `engine/oracle.rs` validates a plain
`PriceInput` (feed id, verification level, price, confidence, publish time,
multiplier) and is exercised by the shared vectors; `instructions/arena.rs`
builds that input from a Pyth `PriceUpdateV2` account whose owner is checked
by the SDK's account type. Program tests run under bankrun
(`solana-program-test`) with receiver-owned fixture accounts and a
controlled clock, so the production validation code runs unchanged (§8.4).

### 8.4 Testing

- `cargo test --test vectors` (programs/tribe_arena): loads
  `packages/core/test-vectors/*.json` and replays every applicable vector —
  math, accrual, underdog, fees, oracle, settlement, proportional
  distribution, upset, and all Arena event streams — against the Rust engine.
- `pnpm --filter @tribe/program-client test:program` (WSL/Linux/macOS):
  bankrun integration tests with real token accounts (legacy SPL and
  Token-2022 mints), fabricated Pyth accounts and clock warps. Bankrun's
  bundled Token-2022 predates `ScaledUiAmount`, so the mainnet Token-2022
  binary is loaded from `tests/fixtures` (`pnpm --filter
  @tribe/program-client fixtures` dumps it; nothing is committed).

`anchor test` against `solana-test-validator` is intentionally not the test
path: Pyth price updates cannot be produced there. LiteSVM was tried first
and dropped — its Node binding aborts (`std::bad_alloc`) after a few
CPI-heavy transactions under WSL2 (see RESEARCH_NOTES).

## 9. Off-chain services (inside `apps/web`)

- **Indexer**: subscribes to program logs (Helius webhooks in production;
  `onLogs` locally), decodes Anchor events, writes Postgres tables
  (`arenas`, `positions`, `events`, `sponsors`, `users`, `leaderboard_*`).
  Idempotent on `(signature, event_index)`.
- **Crank**: cron (every minute) that finds Arenas needing `snapshot_start`,
  `settle` or `sweep`, fetches Pyth updates at the target publish time,
  posts them via the receiver, and sends the instruction. Permissionless by
  design: anyone can run it.
- **Price service**: server-side Hermes polling with an in-memory cache and
  SSE endpoint for the Arena page.
- **Registry sync**: script pulling xStocks assets/oracles and Pyth feed ids
  into `packages/core/registry.json`, from which `set_asset` transactions
  are prepared.

## 10. Demo mode vs. real mode

`TRIBE_MODE` ∈ `live | demo`.

- **live**: reads Arenas from the indexer/program; prices from Pyth; all
  buttons produce real transactions.
- **demo**: seeded Arenas from `apps/web/src/demo/seed.ts` with a
  deterministic simulated price walk seeded by Arena id; wallet actions are
  replaced by an explicit "Demo — no transaction" sheet. Every card and page
  shows a **DEMO** badge.

Both modes share the same components; provenance is a first-class field on
every Arena object (`provenance: 'live' | 'demo' | 'fixture'`) and the UI
must render it. A live deployment may include demo Arenas side by side with
live ones (e.g. to show settlement/Victory Roll states before a live Arena
has settled), always badged.

## 11. Technology stack (pinned 2026-09-12)

| Layer           | Choice                                                                                                 | Version                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Framework       | Next.js (App Router, Turbopack)                                                                        | 16.3.5                                                                                                            |
| UI              | React / React DOM                                                                                      | 19.2.8 (pinned by create-next-app 16.3.5; 19.3.0 is npm latest)                                                   |
| Language        | TypeScript (strict)                                                                                    | 5.9.3 (TS 7 evaluated; deferred until typescript-eslint/vitest support is verified)                               |
| Styling         | Tailwind CSS v4 (`@tailwindcss/postcss`)                                                               | 4.3.3                                                                                                             |
| Primitives      | `radix-ui` (unified package)                                                                           | 1.6.7                                                                                                             |
| Motion          | `motion` (Framer Motion)                                                                               | 13.2.0                                                                                                            |
| Data            | `@tanstack/react-query`                                                                                | 5.102.8                                                                                                           |
| Client state    | `zustand`                                                                                              | 5.0.15                                                                                                            |
| Validation      | `zod`                                                                                                  | 4.6.2                                                                                                             |
| Solana          | `@solana/web3.js` 1.99.0, `@solana/spl-token` 0.4.15                                                   | web3.js v1 line chosen for Anchor/Jupiter/wallet-adapter compatibility; `@solana/kit` migration is post-hackathon |
| Wallets         | `@solana/wallet-adapter-react` 0.15.40, `-react-ui` 0.9.40, `-wallets` 0.19.39                         | wallet-standard auto-discovery                                                                                    |
| Anchor client   | `@anchor-lang/core`                                                                                    | 1.2.0                                                                                                             |
| Pyth            | `@pythnetwork/hermes-client` 3.1.0, `@pythnetwork/pyth-solana-receiver` 0.16.0                         | Hermes API key server-side                                                                                        |
| Jupiter         | REST (`api.jup.ag`, `x-api-key`) via typed fetch; `@jup-ag/api` only if types are useful               | swap v2, price v3, tokens v2                                                                                      |
| DB              | Postgres via Drizzle ORM; PGlite for local/dev                                                         | —                                                                                                                 |
| Tests           | Vitest 5, Playwright (responsive checks), `anchor test` (Rust + TS)                                    | —                                                                                                                 |
| Lint/format     | ESLint 9.39 (flat config; eslint-config-next 16 peers ESLint 9) + typescript-eslint 8.70, Prettier 3.9 | —                                                                                                                 |
| Package manager | pnpm 12                                                                                                | —                                                                                                                 |
| Program         | Anchor 1.2.0, anchor-spl 1.2.0, pyth-solana-receiver-sdk 2.0.0, Agave CLI 4.2.x                        | built in WSL Ubuntu 22.04                                                                                         |
| Hosting         | Vercel (web + cron), Neon (Postgres), Helius (RPC + webhooks)                                          | —                                                                                                                 |

## 12. Environment variables

```
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta | devnet
NEXT_PUBLIC_RPC_URL=              # browser RPC (rate-limited public or Helius)
RPC_URL=                          # server RPC
NEXT_PUBLIC_TRIBE_PROGRAM_ID=
TRIBE_MODE=live | demo
PYTH_HERMES_URL=https://pyth.dourolabs.app/hermes
PYTH_HERMES_API_KEY=
JUPITER_API_KEY=
XSTOCKS_API_URL=https://api.xstocks.fi/api/v2
DATABASE_URL=                     # empty → PGlite in .data/
CRANK_KEYPAIR=                    # base58; funded with SOL for crank txs
HELIUS_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=
```

## 13. Deployment target for the hackathon

The Arena assets (BONK, TSLAx, …) and Pyth equity feeds exist on
**mainnet-beta** only. Options:

- **A. Mainnet program** — fully real end-to-end with tiny amounts. Requires
  ≈2–3 SOL for program rent plus crank fees. _Recommended if budget allows._
- **B. Devnet program + mainnet swaps** — Arena logic on devnet with test
  mints and Pyth devnet feeds; the "real asset interaction" is a mainnet
  Jupiter swap shown separately. Honest but split-brained.

The code is cluster-agnostic; the choice is a configuration and budget
decision recorded in STOCKLANA_PLAN.md.

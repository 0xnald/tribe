# Tribe — Security and Market Integrity

> **Status:** Source of truth for the threat model. Every item lists the
> defence, where it is enforced, and the test that must exist before the
> feature ships.

---

## 1. Principles

1. **Principal is untouchable.** No instruction moves a user's units except
   `exit`, signed by the user, to the user.
2. **Settlement is deterministic and permissionless.** Anyone can start,
   settle, or cancel-on-expiry; the result depends only on Pyth prices at
   fixed timestamps.
3. **Integer arithmetic everywhere money is involved**, in `u128`/`i128`
   with checked operations, floored, dust to the pool.
4. **Fail closed.** Any missing/invalid input rejects the instruction; the
   UI treats a missing price as "unavailable", never as zero.
5. **No fake real-ness.** Demo data is badged; the program is the only
   source of truth for live state.

## 2. Threat matrix

| # | Threat | Defence | Enforced in | Required test |
| --- | --- | --- | --- | --- |
| 1 | Last-second reward sniping | Backing closes at `end_ts − min_hold` (LOCKED); weight is ∫capital dt | program `back` | `back` after `backing_close_ts` fails; weight fixtures (ECONOMICS §5.7) |
| 2 | Backing manipulation for underdog multiplier | `max(instant, TWAB)`, post-deposit share, warm-up ramp, fees on both sides, exit forfeits, per-position cap | program `back`, core | manipulation scenario tests: flash-deposit-other-side yields ≤ 1.01× in warm-up and ≤ TWAB-derived bound later |
| 3 | Oracle manipulation | Pyth only; feed id pinned in registry; `Full` verification; confidence gate; publish-time windows anchored to Arena timestamps | program `snapshot_start`/`settle` | wrong feed id, partial verification, stale/early publish time, wide confidence → all rejected |
| 4 | Low-liquidity price manipulation | Settlement never reads AMMs; registry liquidity/age/organic gates; slippage shown pre-trade | registry, core market-quality | eligibility unit tests with Jupiter fixtures |
| 5 | Wash volume inflating "trending"/eligibility | Organic-volume signals from Jupiter Tokens v2; DN-Institute pool round-trip screen; trending ranks by *backing*, not DEX volume | core, indexer | ranking tests using washed vs organic fixtures |
| 6 | Stale prices | `Exact` mode tolerance 60/120 s; `LastKnown` only for equities within `max_closed_staleness`; `extend_settlement` once; `cancel_expired` | program | staleness boundary tests (±1 s) |
| 7 | Double claims | `claimed` flag set before transfer; one PDA per `(arena, side, user)` | program `claim` | second claim fails; claim with re-derived PDA fails |
| 8 | Replayed / repeated settlement | `settle` requires `status == Live`; sets `Settled` atomically with prices | program | second `settle` fails; settle after cancel fails |
| 9 | Reward pool insolvency | `pool_at_settlement` frozen; shares ≤ 1 by construction; cap without redistribution; payouts floored | program `settle`/`claim` | property test: Σ payouts ≤ pool for random weight sets |
| 10 | Rounding exploits | floor everywhere; dust stays in vault; no user-favouring rounding; minimum backing `≥ 5 USDC` | core + program | fixtures where rounding could create 1 lamport; parity tests TS ↔ Rust |
| 11 | Token-2022 mistakes | `token_interface` + `transfer_checked` with mint & decimals; ATA creation for vaults; registry records `token_program` | program | tests with a Token-2022 mint with `ScaledUiAmount` and a legacy mint |
| 12 | Unsupported extensions (transfer fee, transfer hook) | Registry admission rejects `TransferFeeConfig` and non-null `TransferHook` program; `set_asset` re-checks the mint | program `set_asset` | mint with transfer fee → rejected; hook program set later → asset suspended by monitor |
| 13 | Unsupported assets | `create_arena` requires `AssetEntry.status == Active` for both sides | program | inactive/retired asset → rejected |
| 14 | Creator spam | Creation bond (refunded at SETTLED/CANCELLED), min lead time, min duration, rate limit in UI, indexer hides Arenas with < N participants from Explore | program + indexer | bond accounting test |
| 15 | Fake sponsored rewards | Sponsor deposits are on-chain USDC in the Arena vault; UI shows only vault balance, never a promised number | program + UI | UI renders `reward_vault.amount`; no free-text pool sizes |
| 16 | Arithmetic overflow / precision | `u128` with `checked_*`; prices normalised to Q8 with bounds (`P < 2^63`); unit-seconds bounded by `u64 × 2^31` | program + core | overflow tests at max plausible values (1e18 units × 30 days) |
| 17 | Fee bypass by hand-crafted tx | `back` enforces `fee_paid ≥ notional(P_start) × fee_bps` on-chain | program | under-paid fee → rejected |
| 18 | Stranded funds (dead crank / absent authority) | `cancel_expired` permissionless; `exit` always allowed | program | state-machine tests: every state reaches terminal without authority |
| 19 | Issuer-side actions (pause, freeze, permanent delegate on xStocks) | Documented; Arena keeps running on oracle prices; exits retry after unpause; long pause → cancel | docs + ops | pause simulation in tests (mock mint) |
| 20 | Server key compromise (Hermes / Jupiter / crank) | Keys server-side only; crank key holds only fee SOL; no key can move user funds or change results | ops | — |
| 21 | Frontend supply-chain / phishing | Pinned dependencies, lockfile, CSP, transaction preview shows every instruction summary before signing | web | Playwright: preview lists fee, route, position |
| 22 | Sybil on leaderboards | Minimum participation thresholds; capital tiers are log-scaled; creator boards need ≥ 10 distinct participants | indexer | leaderboard eligibility tests |
| 23 | Clock drift | ≥ 60 s tolerances; derived states from timestamps | program | boundary tests |

## 3. Underdog manipulation — cost/benefit record

Attacker goal: obtain multiplier `m` on capital `C` on side B by inflating
side A.

- Warm-up phase (first `max(10%, 30 min)`): ramp makes `m ≈ 1.00`. Cost:
  fee on both deposits. Benefit ≈ 0. **Unprofitable.**
- Mid-Arena, existing backing `X` per side at elapsed `e`: to reach share
  20% on B via TWAB, hold `4X` on A for `T` with
  `(e + T) / (2e + 6T) ≤ 0.2` ⇒ `T ≥ 3e` (e.g. `e = 6 h` ⇒ `T ≥ 18 h`).
  Meanwhile the attacker's B tranche, deposited at `e + T`, has at most
  `duration − e − T` of accrual (≤ 0 in the example) — the multiplier
  multiplies almost nothing. **Self-defeating.**
- Instantaneous-only attack (flash deposit, deposit on B, exit A): blocked
  by `max(instant, TWAB)` — instant drops, TWAB does not; the max is the
  TWAB. Benefit ≈ 0. Cost: fee on `4X`.
- Residual: an attacker who is *also* the majority of backing can shape both
  integrals. Bounded by the 25% per-position cap and by the fact that the
  multiplier only redistributes within the winning side. Accepted for MVP;
  post-MVP: per-wallet cap on multiplier-weighted share and cross-wallet
  clustering in the indexer.

## 4. Program-level hardening checklist

- [ ] All accounts constrained by seeds + `has_one`; no `UncheckedAccount`
      without a documented reason.
- [ ] Token accounts validated: `mint`, `owner`, `token_program` match the
      registry entry.
- [ ] `init_if_needed` only for `Position`, with owner check.
- [ ] Reentrancy irrelevant (no CPI into untrusted programs); Jupiter swap
      instructions are siblings in the transaction, not CPIs.
- [ ] Events for every state change.
- [ ] Upgrade authority: multisig; documented as upgradeable during the
      hackathon.
- [ ] Rust unit tests for math (parity with `packages/core` vectors).
- [ ] Anchor integration tests for every transition and every rejection in
      the threat matrix.

## 5. Web/API hardening checklist

- [ ] API keys only in server routes; `NEXT_PUBLIC_*` limited to cluster,
      RPC URL, program id, app URL.
- [ ] Rate limiting on `/api/quote`, `/api/tx/*`, `/api/oracle/*`.
- [ ] Transaction builder returns instruction summaries the UI renders in
      the preview (fee, route, expected units, vault destination).
- [ ] Never place wallet addresses or amounts in query strings for
      state-changing endpoints (POST bodies only).
- [ ] CSP, `Permissions-Policy`, HSTS on Vercel.
- [ ] Indexer idempotency on `(signature, event_index)`.

## 6. Known limitations (documented in README)

- The program is upgradeable during the hackathon.
- Registry admission is operated by the Tribe authority; Arena creation is
  permissionless only over that registry.
- Wash-trading screening for new assets is semi-manual for the MVP.
- Existing-holdings entries move units into a program-owned vault (with
  user-only withdrawal) rather than leaving them in the wallet; this is
  the price of honest holding verification.
- `LastKnown` settlement for equities outside US market hours freezes that
  side's performance; the UI says so wherever it applies.

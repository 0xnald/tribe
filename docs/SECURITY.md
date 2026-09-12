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

| #   | Threat                                                             | Defence                                                                                                                                               | Enforced in                       | Required test                                                                                                  |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Last-second reward sniping                                         | Backing closes at `end_ts − min_hold` (LOCKED); weight is ∫capital dt                                                                                 | program `back`                    | `back` after `backing_close_ts` fails; weight fixtures (ECONOMICS §5.7)                                        |
| 2   | Backing manipulation for underdog multiplier                       | `max(instant, TWAB)`, post-deposit share, warm-up ramp, fees on both sides, exit forfeits, per-position cap                                           | program `back`, core              | manipulation scenario tests: flash-deposit-other-side yields ≤ 1.01× in warm-up and ≤ TWAB-derived bound later |
| 3   | Oracle manipulation                                                | Pyth only; feed id pinned in registry; `Full` verification; confidence gate; publish-time windows anchored to Arena timestamps                        | program `snapshot_start`/`settle` | wrong feed id, partial verification, stale/early publish time, wide confidence → all rejected                  |
| 4   | Low-liquidity price manipulation                                   | Settlement never reads AMMs; registry liquidity/age/organic gates; slippage shown pre-trade                                                           | registry, core market-quality     | eligibility unit tests with Jupiter fixtures                                                                   |
| 5   | Wash volume inflating "trending"/eligibility                       | Organic-volume signals from Jupiter Tokens v2; DN-Institute pool round-trip screen; trending ranks by _backing_, not DEX volume                       | core, indexer                     | ranking tests using washed vs organic fixtures                                                                 |
| 6   | Stale prices                                                       | `Exact` mode tolerance 60/120 s; `LastKnown` only for equities within `max_closed_staleness`; `extend_settlement` once; `cancel_expired`              | program                           | staleness boundary tests (±1 s)                                                                                |
| 7   | Double claims                                                      | `claimed` flag set before transfer; one PDA per `(arena, side, user)`                                                                                 | program `claim`                   | second claim fails; claim with re-derived PDA fails                                                            |
| 8   | Replayed / repeated settlement                                     | `settle` requires `status == Live`; sets `Settled` atomically with prices                                                                             | program                           | second `settle` fails; settle after cancel fails                                                               |
| 9   | Reward pool insolvency                                             | `pool_at_settlement` frozen; shares ≤ 1 by construction; cap without redistribution; payouts floored                                                  | program `settle`/`claim`          | property test: Σ payouts ≤ pool for random weight sets                                                         |
| 10  | Rounding exploits                                                  | floor everywhere; dust stays in vault; no user-favouring rounding; minimum backing `≥ 5 USDC`                                                         | core + program                    | fixtures where rounding could create 1 lamport; parity tests TS ↔ Rust                                         |
| 11  | Token-2022 mistakes                                                | `token_interface` + `transfer_checked` with mint & decimals; ATA creation for vaults; registry records `token_program`                                | program                           | tests with a Token-2022 mint with `ScaledUiAmount` and a legacy mint                                           |
| 12  | Unsupported extensions (transfer fee, transfer hook)               | Registry admission rejects `TransferFeeConfig` and non-null `TransferHook` program; `set_asset` re-checks the mint                                    | program `set_asset`               | mint with transfer fee → rejected; hook program set later → asset suspended by monitor                         |
| 13  | Unsupported assets                                                 | `create_arena` requires `AssetEntry.status == Active` for both sides                                                                                  | program                           | inactive/retired asset → rejected                                                                              |
| 14  | Creator spam                                                       | Creation bond (refunded at SETTLED/CANCELLED), min lead time, min duration, rate limit in UI, indexer hides Arenas with < N participants from Explore | program + indexer                 | bond accounting test                                                                                           |
| 15  | Fake sponsored rewards                                             | Sponsor deposits are on-chain USDC in the Arena vault; UI shows only vault balance, never a promised number                                           | program + UI                      | UI renders `reward_vault.amount`; no free-text pool sizes                                                      |
| 16  | Arithmetic overflow / precision                                    | `u128` with `checked_*`; prices normalised to Q8 with bounds (`P < 2^63`); unit-seconds bounded by `u64 × 2^31`                                       | program + core                    | overflow tests at max plausible values (1e18 units × 30 days)                                                  |
| 17  | Fee bypass by hand-crafted tx                                      | `back` enforces `fee_paid ≥ notional(P_start) × fee_bps` on-chain                                                                                     | program                           | under-paid fee → rejected                                                                                      |
| 18  | Stranded funds (dead crank / absent authority)                     | `cancel_expired` permissionless; `exit` always allowed                                                                                                | program                           | state-machine tests: every state reaches terminal without authority                                            |
| 19  | Issuer-side actions (pause, freeze, permanent delegate on xStocks) | Documented; Arena keeps running on oracle prices; exits retry after unpause; long pause → cancel                                                      | docs + ops                        | pause simulation in tests (mock mint)                                                                          |
| 20  | Server key compromise (Hermes / Jupiter / crank)                   | Keys server-side only; crank key holds only fee SOL; no key can move user funds or change results                                                     | ops                               | —                                                                                                              |
| 21  | Frontend supply-chain / phishing                                   | Pinned dependencies, lockfile, CSP, transaction preview shows every instruction summary before signing                                                | web                               | Playwright: preview lists fee, route, position                                                                 |
| 22  | Sybil on leaderboards                                              | Minimum participation thresholds; capital tiers are log-scaled; creator boards need ≥ 10 distinct participants                                        | indexer                           | leaderboard eligibility tests                                                                                  |
| 23  | Clock drift                                                        | ≥ 60 s tolerances; derived states from timestamps                                                                                                     | program                           | boundary tests                                                                                                 |

## 3. Underdog manipulation — findings from the Phase 1 simulations

The scenarios below are executed by `packages/core/src/engine/underdog.test.ts`
(S1–S13) and the fast-check properties in `properties.test.ts`. Numbers are
from the tests, not estimates. Attacker goal throughout: obtain multiplier
`m > 1` on capital `C` on side B by inflating side A. Honest backing is `X`
per side unless stated.

| #      | Scenario                                                            | Result (measured)                                                                                                                                                                      | Classification                                                                         |
| ------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| S1     | Back 4X on A at `t0+30s`, back B at `t0+60s` (24 h Arena)           | `m ≤ 1.005×` — warm-up ramp is 60/8640                                                                                                                                                 | **Prevented**                                                                          |
| S2     | Mid-Arena (6 h in): back 4X on A, back B one second later, exit A   | `m ≤ 1.001×` (TWAB 4999 bps); A leg forfeits all weight                                                                                                                                | **Prevented**                                                                          |
| S3     | Hold 4X on A from `t0`, back B at 18 h                              | `m = 1.43×` (instant share after own deposit caps it), tranche has 6 h left: attacker weight < ½ of an honest 24 h backer of equal size, while holding $40k of the losing side all day | **Economically mitigated** (self-defeating)                                            |
| S4     | Split $4k across 4 wallets vs one wallet                            | Σ eff_units within 1 % and never higher than the single wallet                                                                                                                         | **Prevented** (no gain from splitting)                                                 |
| S5     | Whale on both sides                                                 | Own-side 99 % share ⇒ `1.0×`; other-side tranche `≤ 1.002×`                                                                                                                            | **Prevented**                                                                          |
| S6     | Whale at `backing_close_ts`                                         | Rejected `BackingClosed`; one second earlier accepted at `1.0×` with only `min_hold` of accrual                                                                                        | **Prevented**                                                                          |
| S7     | 20 drip deposits of $100                                            | Multiplier non-increasing, `1.0×` throughout                                                                                                                                           | **Prevented**                                                                          |
| S8     | Genuine 20 % underdog                                               | `1.06×` at 10 % of warm-up, `≈1.6×` after warm-up                                                                                                                                      | Intended behaviour                                                                     |
| S9–S10 | One-sided Arena, same-block first backers                           | `1.0×`; TWAB undefined ⇒ instant share, ramp 0                                                                                                                                         | **Prevented**                                                                          |
| S11    | 1 h Arena, 15 min in                                                | `≈1.30×` (half of a 1.6× ramp; floor 30 min)                                                                                                                                           | Intended                                                                               |
| S12    | **30-day Arena**: back 10X on A at day 10, back B at day 11, exit A | `m = 1.31×` on the B tranche for the remaining 19 days. Cost: 0.5 % fee on 10X (≈ $500 on $100k) + one day of market exposure on the losing side.                                      | **Accepted MVP risk** — see cost/benefit below                                         |
| S12b   | S12 with `underdogSettlementClamp = true`                           | attacker weight reduced to `unit_seconds × m_settlement` (`m_settlement ≈ 1.14×` from the whole-Arena TWAB); honest 1.0× positions unchanged                                           | **Post-hackathon hardening** (implemented, off by default; proposal in ECONOMICS §7.4) |
| S13    | Tiny (\$6/\$6) Arena                                                | multiplier bounded in `[1.0, 2.0]`, deterministic                                                                                                                                      | **Prevented** (bounds)                                                                 |
| Upset  | Whale makes A the 90 % favourite one second before cutoff           | winner TWAB share ≈ 35 % (not 10 %); `m_upset < 1.35×`                                                                                                                                 | **Prevented** for the pool-level bonus                                                 |

### 3.1 Residual cost/benefit (S12 class)

With honest backing `X` per side at elapsed `e`, an attacker holding `kX`
on A for `T` seconds drives B's TWAB share to `(e + T) / (2e + (2 + k) T)`.
Reaching 20 % needs `kT ≥ 3e + 2T`; at `e = 10 d` in a 30-day Arena that is
`k = 10, T ≥ 1.6 d` or `k = 4, T ≥ 15 d`. The multiplier then applies to a
tranche whose remaining accrual is `duration − e − T`. The attack is only
profitable when the reward pool is large relative to total backing (roughly
`pool / backing ≳ fee × k / (m − 1)` ≈ 0.5 % × 10 / 0.31 ≈ 16 % for S12) —
i.e. heavily sponsored, thinly backed, long Arenas. Mitigations available
without changing accounts: shorter default durations for sponsored Arenas,
a lower `underdog.capQ4` for Arenas whose pool/backing ratio is high, or
enabling the settlement clamp (S12b).

### 3.2 Reward-cap and Sybil findings (distribution.test.ts)

- A per-position payout cap is **not** a Sybil defence: splitting a 90 %
  whale into four wallets defeats HardCap, WaterFill and ConditionalCap
  alike (the split wallets collectively receive strictly more), while pure
  proportional distribution is split-neutral up to dust. Sybil resistance
  comes from fees and rent per wallet, not from the cap.
- The Phase 0 HardCap causes large _unnecessary_ rollover: a lone winner
  receives 25 % of the pool; two equal winners 50 %; in the happy-path
  vector (`arena.json`) 46 % of a 14.5 USDC pool rolls over. See
  ECONOMICS §6.6 for the comparison and recommendation.

### 3.3 Threat-matrix status after Phase 1

| Rows                                                                                                                                                   | Status                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (sniping), 7 (double claim), 8 (replayed settlement), 9 (insolvency), 10 (rounding), 16 (overflow), 17 (fee bypass), 18 (stranded funds), 23 (clock) | **Prevented** in `packages/core`; guarded by unit + property tests and `arena.json` vectors. The program must replay the same vectors.                                                      |
| 2 (underdog manipulation)                                                                                                                              | **Prevented / economically mitigated** per §3; S12 class **accepted MVP risk**.                                                                                                             |
| 3 (oracle), 6 (stale prices)                                                                                                                           | **Prevented** by `validatePriceUpdate` (18 oracle vectors). On-chain enforcement pending Phase 2.                                                                                           |
| 4 (low-liquidity), 5 (wash), 11–13 (Token-2022 / unsupported assets)                                                                                   | **Prevented** at admission by the market-quality model (fixtures: RUGME, FEEx, STALEx rejected; TSLAx warns on the DN-Institute wash signature). On-chain extension checks pending Phase 2. |
| 14 (creator spam), 15 (fake sponsors), 19 (issuer actions), 20–22 (ops / web / Sybil)                                                                  | **Post-hackathon hardening** or operational; not exercised by the core engine.                                                                                                              |

A claim of "prevented" above means a test in `packages/core` fails if the
protection is removed.

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

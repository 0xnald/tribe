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
| 2   | Backing manipulation for underdog multiplier                       | `max(instant, TWAB)`, post-deposit share, warm-up ramp, fees on both sides, exit forfeits, settlement clamp (ECONOMICS §7.4)                          | program `back`, core              | manipulation scenario tests: flash-deposit-other-side yields ≤ 1.01× in warm-up and ≤ TWAB-derived bound later |
| 3   | Oracle manipulation                                                | Pyth only; feed id pinned in registry; `Full` verification; confidence gate; publish-time windows anchored to Arena timestamps                        | program `snapshot_start`/`settle` | wrong feed id, partial verification, stale/early publish time, wide confidence → all rejected                  |
| 4   | Low-liquidity price manipulation                                   | Settlement never reads AMMs; registry liquidity/age/organic gates; slippage shown pre-trade                                                           | registry, core market-quality     | eligibility unit tests with Jupiter fixtures                                                                   |
| 5   | Wash volume inflating "trending"/eligibility                       | Organic-volume signals from Jupiter Tokens v2; DN-Institute pool round-trip screen; trending ranks by _backing_, not DEX volume                       | core, indexer                     | ranking tests using washed vs organic fixtures                                                                 |
| 6   | Stale prices                                                       | `Exact` mode tolerance 60/120 s; `LastKnown` only for equities within `max_closed_staleness`; `extend_settlement` once; `cancel_expired`              | program                           | staleness boundary tests (±1 s)                                                                                |
| 7   | Double claims                                                      | `claimed` flag set before transfer; one PDA per `(arena, side, user)`                                                                                 | program `claim`                   | second claim fails; claim with re-derived PDA fails                                                            |
| 8   | Replayed / repeated settlement                                     | `settle` requires `status == Live`; sets `Settled` atomically with prices                                                                             | program                           | second `settle` fails; settle after cancel fails                                                               |
| 9   | Reward pool insolvency                                             | `pool_at_settlement` and `W_total ≥ Σ W_i` frozen at settlement; proportional floor payouts                                                           | program `settle`/`claim`          | property test: Σ payouts ≤ pool for random weight sets                                                         |
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

| #      | Scenario                                                            | Result (measured)                                                                                                                                                                                                                                | Classification                                                            |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| S1     | Back 4X on A at `t0+30s`, back B at `t0+60s` (24 h Arena)           | `m ≤ 1.005×` — warm-up ramp is 60/8640                                                                                                                                                                                                           | **Prevented**                                                             |
| S2     | Mid-Arena (6 h in): back 4X on A, back B one second later, exit A   | `m ≤ 1.001×` (TWAB 4999 bps); A leg forfeits all weight                                                                                                                                                                                          | **Prevented**                                                             |
| S3     | Hold 4X on A from `t0`, back B at 18 h                              | `m = 1.43×` (instant share after own deposit caps it), tranche has 6 h left: attacker weight < ½ of an honest 24 h backer of equal size, while holding $40k of the losing side all day                                                           | **Economically mitigated** (self-defeating)                               |
| S4     | Split $4k across 4 wallets vs one wallet                            | Σ eff_units within 1 % and never higher than the single wallet                                                                                                                                                                                   | **Prevented** (no gain from splitting)                                    |
| S5     | Whale on both sides                                                 | Own-side 99 % share ⇒ `1.0×`; other-side tranche `≤ 1.002×`                                                                                                                                                                                      | **Prevented**                                                             |
| S6     | Whale at `backing_close_ts`                                         | Rejected `BackingClosed`; one second earlier accepted at `1.0×` with only `min_hold` of accrual                                                                                                                                                  | **Prevented**                                                             |
| S7     | 20 drip deposits of $100                                            | Multiplier non-increasing, `1.0×` throughout                                                                                                                                                                                                     | **Prevented**                                                             |
| S8     | Genuine 20 % underdog                                               | `1.06×` at 10 % of warm-up, `≈1.6×` after warm-up                                                                                                                                                                                                | Intended behaviour                                                        |
| S9–S10 | One-sided Arena, same-block first backers                           | `1.0×`; TWAB undefined ⇒ instant share, ramp 0                                                                                                                                                                                                   | **Prevented**                                                             |
| S11    | 1 h Arena, 15 min in                                                | `≈1.30×` (half of a 1.6× ramp; floor 30 min)                                                                                                                                                                                                     | Intended                                                                  |
| S12    | **30-day Arena**: back 10X on A at day 10, back B at day 11, exit A | Entry multiplier `1.31×` is granted on the B tranche…                                                                                                                                                                                            | see S12b                                                                  |
| S12b   | …but at settlement the normative clamp (Decision 2) applies         | B's whole-Arena TWAB share is 55 % once the attacker's own B stake is counted ⇒ `m_settle = 1.0×`; the attacker's final weight is `unit_seconds × 1.0` (the 1.31× boost is removed entirely); honest 1.0× positions unchanged; `Σ W_i ≤ W_total` | **Prevented** (`arena.json` "S12 attack" vector; `underdog.test.ts` S12b) |
| S13    | Tiny (\$6/\$6) Arena                                                | multiplier bounded in `[1.0, 2.0]`, deterministic                                                                                                                                                                                                | **Prevented** (bounds)                                                    |
| Upset  | Whale makes A the 90 % favourite one second before cutoff           | winner TWAB share ≈ 35 % (not 10 %); `m_upset < 1.35×`                                                                                                                                                                                           | **Prevented** for the pool-level bonus                                    |

### 3.1 Residual cost/benefit (S12 class, before the clamp — kept for the record)

With honest backing `X` per side at elapsed `e`, an attacker holding `kX`
on A for `T` seconds drives B's TWAB share to `(e + T) / (2e + (2 + k) T)`.
Reaching 20 % needs `kT ≥ 3e + 2T`; at `e = 10 d` in a 30-day Arena that is
`k = 10, T ≥ 1.6 d` or `k = 4, T ≥ 15 d`. The multiplier then applies to a
tranche whose remaining accrual is `duration − e − T`. The attack is only
profitable when the reward pool is large relative to total backing (roughly
`pool / backing ≳ fee × k / (m − 1)` ≈ 0.5 % × 10 / 0.31 ≈ 16 % for S12) —
i.e. heavily sponsored, thinly backed, long Arenas. **Decision 2 made the
settlement clamp normative**, which removes the locked-in boost: a
manipulated tranche can never pay more than `unit_seconds × m_settle`, and
`m_settle` derives from the whole-Arena TWAB, which the attacker's own
holdings push _against_ them. What remains is the honest, bounded case: a
side that genuinely was the underdog over the whole Arena pays its early
backers up to `cap_q4`.

### 3.2 Reward-cap and Sybil findings (distribution.test.ts)

- A per-position payout cap is **not** a Sybil defence: splitting a 90 %
  whale into four wallets defeats HardCap, WaterFill and ConditionalCap
  alike (the split wallets collectively receive strictly more), while pure
  proportional distribution is split-neutral up to dust. Sybil resistance
  comes from fees and rent per wallet, not from the cap.
- The Phase 0 HardCap caused large _unnecessary_ rollover (lone winner 25 %,
  two equal winners 50 %, happy-path vector 46 %). **Decision 1 replaced it
  with proportional payout** (ECONOMICS §6.1); the capped variants remain
  internal analysis utilities only.

### 3.3 Threat-matrix status after Phase 1

| Rows                                                                                                                                                   | Status                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (sniping), 7 (double claim), 8 (replayed settlement), 9 (insolvency), 10 (rounding), 16 (overflow), 17 (fee bypass), 18 (stranded funds), 23 (clock) | **Prevented** in `packages/core`; guarded by unit + property tests and `arena.json` vectors. The program must replay the same vectors.                                                      |
| 2 (underdog manipulation)                                                                                                                              | **Prevented / economically mitigated** per §3; the S12 class is now **prevented** by the normative settlement clamp (Decision 2).                                                           |
| 3 (oracle), 6 (stale prices)                                                                                                                           | **Prevented** by `validatePriceUpdate` (18 oracle vectors). On-chain enforcement pending Phase 2.                                                                                           |
| 4 (low-liquidity), 5 (wash), 11–13 (Token-2022 / unsupported assets)                                                                                   | **Prevented** at admission by the market-quality model (fixtures: RUGME, FEEx, STALEx rejected; TSLAx warns on the DN-Institute wash signature). On-chain extension checks pending Phase 2. |
| 14 (creator spam), 15 (fake sponsors), 19 (issuer actions), 20–22 (ops / web / Sybil)                                                                  | **Post-hackathon hardening** or operational; not exercised by the core engine.                                                                                                              |

A claim of "prevented" above means a test in `packages/core` fails if the
protection is removed.

## 4. Program security review (Phase 2, `programs/tribe_arena`)

Each row states the mechanism in the code and the test that exercises it
(`packages/program-client/tests/program.test.ts` under bankrun unless noted).

| Area                                    | Mechanism                                                                                                                                                                                                                                                                                                                                                                            | Test                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDA seed collisions                     | Distinct literal prefixes (`config`, `asset`, `arena`, `position`, `sponsor`); `arena` seeds include creator + 8-byte LE nonce; `position` seeds include arena + 1-byte side + owner; bumps stored and re-checked with `bump = account.bump`.                                                                                                                                        | seeds mismatch on a foreign position → `AccountNotInitialized`/`ConstraintSeeds`                                                                                                                                            |
| Account ownership                       | All state accounts are `Account<T>` (owner = program, discriminator checked). Pyth updates are `Account<PriceUpdateV2>` whose owner is the receiver program (SDK type).                                                                                                                                                                                                              | non-receiver-owned price account → `AccountOwnedByWrongProgram`                                                                                                                                                             |
| Signer requirements                     | `owner` signs `back`/`exit`/`claim`; `authority` signs admin instructions (`has_one = authority`); crank instructions accept any signer (permissionless by design).                                                                                                                                                                                                                  | non-authority `set_asset`/`cancel_arena` → `Unauthorized`; creator cannot cancel                                                                                                                                            |
| Account substitution                    | `reward_vault` pinned by `address = arena.reward_vault`; treasury/reserve pinned to config; position vault is `associated_token::authority = position`; owner token accounts require `token::authority = owner`; mints pinned to `arena.assets[side].mint`.                                                                                                                          | wrong mint → `MintMismatch`; foreign owner account → `ConstraintTokenOwner`; substituted position vault → `ConstraintTokenOwner` (vault authority must be the position PDA); substituted reward vault → `ConstraintAddress` |
| Token program substitution              | `asset_token_program` must equal the registered program (`address = arena.assets[side].token_program`); mints declared with `mint::token_program`, so a swapped program fails the mint check first.                                                                                                                                                                                  | `ConstraintMintTokenProgram` (registration and `back`)                                                                                                                                                                      |
| Mint substitution at creation           | `create_arena` takes `AssetEntry` PDAs derived from the mint; a creator cannot pass an unregistered mint.                                                                                                                                                                                                                                                                            | unregistered mint → `AccountNotInitialized`                                                                                                                                                                                 |
| Arbitrary CPI                           | The program only CPIs into the token programs (transfer_checked) and the ATA/system programs for account creation; no CPI into user-supplied programs.                                                                                                                                                                                                                               | — (by construction)                                                                                                                                                                                                         |
| Vault authority                         | Position vault authority is the `Position` PDA; reward vault authority is the `Arena` PDA; reserve authority is the `Config` PDA. Only `exit`, `claim`, `refund_sponsor`, `sweep_unclaimed`, `settle` sign with them, each to a destination constrained by the instruction.                                                                                                          | principal invariant test                                                                                                                                                                                                    |
| Unchecked accounts / remaining_accounts | `back` receives the three USDC fee legs as `UncheckedAccount`s to fit the SBF stack; each is pinned by `address =` to `config.treasury`, `config.upset_reserve` and the creator's derived USDC ATA / `arena.reward_vault`, and paid with `transfer_checked` (mint + decimals from config), so a wrong account fails the address check or the token program. No `remaining_accounts`. | substituted reward vault → `ConstraintAddress`                                                                                                                                                                              |
| Arithmetic                              | `checked_*`/`mul_div` (U256) everywhere; `overflow-checks = true` in release; Q8 normalisation bounds prices to u64.                                                                                                                                                                                                                                                                 | vector parity (`cargo test`), overflow vector                                                                                                                                                                               |
| Precision / rounding                    | Floor everywhere; protocol share absorbs fee rounding; forfeited part absorbs exit rounding; payouts floored.                                                                                                                                                                                                                                                                        | vectors `fees`, `accrual`, `distribution`                                                                                                                                                                                   |
| Reinitialization                        | `init` for config/arena (fails if exists); `init_if_needed` only for `Position` (via `open_position`, Scheduled/Live only), `Sponsor` and vault ATAs, with owner/side re-checked on reuse.                                                                                                                                                                                           | `init_config` twice → system `already in use`; `open_position` on a settled Arena → `InvalidStatus`                                                                                                                         |
| Duplicate claim / settlement / refund   | `claimed` flag set before CPI; `settle` requires `Live`; `refunded` flag on `Sponsor`.                                                                                                                                                                                                                                                                                               | `AlreadyClaimed`, `AlreadySettled`, `SponsorAlreadyRefunded`                                                                                                                                                                |
| Timestamp assumptions                   | `Clock::get()` only; windows have ≥ 60 s tolerances; late cranks use the update published at the target time (publish-time window), so the price cannot be chosen by delaying.                                                                                                                                                                                                       | late settle at `end_ts + 2 h` uses the `end_ts` print                                                                                                                                                                       |
| Rent / account closure                  | No account is ever closed by the program in the MVP (no rent-drain vector; positions remain as audit records).                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                           |
| Sponsor insolvency                      | Sponsor deposits are real transfers into the vault before the record is credited; refunds bounded by `reward_pool_balance`.                                                                                                                                                                                                                                                          | refund flows                                                                                                                                                                                                                |
| Reward insolvency                       | `pool_at_settlement` frozen from `reward_pool_balance` (≤ vault balance); `W_total ≥ Σ W_i`; claim requires `amount ≤ reward_pool_balance`.                                                                                                                                                                                                                                          | Σ claims ≤ pool test; vector `arena.json`                                                                                                                                                                                   |
| Principal / reward mixing               | Principal lives in per-position asset vaults; rewards in the USDC vault; no instruction moves asset units except `exit` to the owner, and no instruction moves USDC to anyone but claimant/sponsor/treasury.                                                                                                                                                                         | "losing principal never becomes winning principal" test                                                                                                                                                                     |
| Pause                                   | `paused` blocks `create_arena` and `back` only; exits, settlement, claims and refunds keep working so a pause can never strand funds.                                                                                                                                                                                                                                                | pause test                                                                                                                                                                                                                  |

Findings while writing the program (all fixed before tests):

1. `CpiContext` in Anchor 1.x takes the program id, not the account info —
   caught at compile time.
2. `pool × W_i` overflowed `u128` for large positions in long Arenas; a
   256-bit intermediate was introduced for every `floor(a × b / d)` on the
   money path (`engine/u256.rs`).
3. The TS engine mapped a Q8 overflow to `OracleUnsupportedExponent`; the
   Rust engine reported `MathOverflow`. The TS side was wrong per
   ARCHITECTURE §5.3 and was corrected; the shared vector regenerated.
4. Building for SBF exposed 4 KiB stack-frame overflows in `claim` and in
   the generated account validation of `back`, `fund_reward_pool`,
   `settle` and `refund_sponsor`. Fixed by boxing every account, removing a
   `Position` clone and moving position/vault creation into
   `open_position`. A stack overflow that only appears at runtime would
   have made those instructions unusable, so the SBF build (not just
   `cargo check`) is part of validation.
5. `open_position` initially had no status guard, so positions (and rent)
   could be created on settled/cancelled Arenas; it now requires
   Scheduled/Live.

Not yet covered (post-hackathon): formal audit; upgrade-authority
multisig; `Rollover` per-pair vaults; token-account closing/rent reclaim;
fuzzing of the instruction layer beyond the shared vectors.

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

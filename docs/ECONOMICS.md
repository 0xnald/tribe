# Tribe — Arena Economics

> **Status:** Source of truth for every number the protocol computes. All
> formulas here are specified in integer / fixed-point arithmetic and are the
> reference for `packages/core` (TypeScript) and `programs/tribe_arena`
> (Rust). Both implementations must agree bit-for-bit on the shared test
> vectors in `packages/core/src/__fixtures__/`.

---

## 0. Notation and number formats

| Symbol        | Meaning                                        | Representation           |
| ------------- | ---------------------------------------------- | ------------------------ |
| `units`       | Raw token amount of an asset (smallest unit)   | `u64`                    |
| `d`           | Token decimals                                 | `u8`                     |
| `P`           | Reference price in **Q8 USD** (USD × 10⁸)      | `u64` (fits: $10¹⁰ max)  |
| `mult`        | xStocks scaled-UI multiplier in **Q6** (× 10⁶) | `u64`, `1_000_000` = 1.0 |
| `usdc`        | USDC amount in micro-USDC (10⁻⁶)               | `u64`                    |
| `bps`         | Basis points, 10 000 = 100%                    | `u16`/`u32`              |
| `t`           | Unix timestamp, seconds                        | `i64`                    |
| `unitSeconds` | ∫ units dt                                     | `u128`                   |

Rules:

- **No floating point** in any settlement, fee, weight, or payout
  computation, in either language.
- Multiplications are performed in `u128`/`i128`; division is the last
  operation; results are floored. Rounding dust always favours the pool /
  protocol, never a user, and never creates value.
- Percentages returned to the UI are derived from these integers; the UI
  never re-derives money from floats.

### 0.1 Reference price of one raw unit

For crypto assets, `P_ref = P_pyth` normalised to Q8.

For xStocks (Token-2022 with the `ScaledUiAmount` extension) the raw on-chain
balance is constant and corporate actions are expressed through the mint's
multiplier. One raw unit is worth `multiplier` underlying shares, so:

```
P_ref = P_underlying_q8 * mult_q6 / 1_000_000
```

where `P_underlying` is the Pyth `Equity.US.<TICKER>/USD` feed and `mult_q6`
is read from the mint at snapshot time (see ARCHITECTURE.md §5). This makes
splits, reverse splits and reinvested dividends price-continuous for Arena
purposes without any special casing.

### 0.2 Notional value

```
notional_usdc(units, P_ref, d) = units * P_ref / 10^(d + 2)
```

(Q8 price × units / 10^d gives USD × 10⁸; dividing by 10² yields micro-USDC.)

---

## 1. Real spot ownership

A user backs one side of an Arena with either:

- **USDC** — swapped into the asset through Jupiter in the same transaction
  that creates the Arena Position; or
- **Existing holdings** — a chosen amount of the asset already held in the
  wallet.

In both cases the units are transferred into an **Arena Position Vault**: a
program-derived token account for `(arena, side, user)` from which **only the
user** can withdraw (see ARCHITECTURE.md §4 for why this is the chosen
custody model). The user keeps full economic exposure to the asset. The
program has no instruction that moves a user's units anywhere except back to
that user.

Arena outcome does not override market PnL:

```
underlying_value_now = notional_usdc(units, P_ref_now, d)
```

---

## 2. Arena performance and winner

Both sides are measured as percentage return from the Arena's start reference
price to its settlement reference price.

```
perf_bps(side) = (P_end - P_start) * 10_000 / P_start        (i128, floored)
```

The winner is decided **without division** to avoid rounding asymmetry:

```
lhs = P_end_A * P_start_B          (u128)
rhs = P_end_B * P_start_A          (u128)

tie_band = tie_bps * P_start_A * P_start_B / 10_000

if |lhs - rhs| <= tie_band  -> TIE
else if lhs > rhs           -> A wins
else                        -> B wins
```

`tie_bps` defaults to **1** (0.01%) and is an Arena parameter.

Only the _reference prices_ defined in ARCHITECTURE.md §5 may be used. DEX
last-trade prints are never a settlement source.

---

## 3. Fees

Fees are the primary funding source of Arena Rewards. They are **policy
parameters** captured into every Arena at creation (so a later policy change
never alters a running Arena).

| Parameter               | Default    | Notes                                                                       |
| ----------------------- | ---------- | --------------------------------------------------------------------------- |
| `fee_bps`               | 50 (0.50%) | Charged on every Back, in USDC.                                             |
| `split.reward_pool_bps` | 4000       | To the Arena Reward Pool vault.                                             |
| `split.protocol_bps`    | 4000       | To the Tribe treasury.                                                      |
| `split.creator_bps`     | 2000       | To the Arena Creator.                                                       |
| `creator_share_target`  | `Creator`  | `Creator` / `Protocol` / `RewardPool`; first-party Arenas use `RewardPool`. |

Constraint: `reward_pool_bps + protocol_bps + creator_bps == 10_000`.

### 3.1 Fee base

The fee is charged on the **Arena-start notional** of the units being backed:

```
fee_required = notional_usdc(units, P_start(side), d) * fee_bps / 10_000
```

This has two properties we want:

- It is enforceable on-chain for both entry methods (the program knows
  `units` and `P_start`; it cannot see how much USDC a Jupiter route consumed).
- It is identical for a USDC entry and an existing-holdings entry of the same
  size, so neither path can be used to dodge fees.

The client charges `max(fee_required, usdc_in * fee_bps / 10_000)` for USDC
entries so that the fee is never below 0.50% of what the user actually spent.
The program enforces `fee_paid >= fee_required`.

### 3.2 Fee split

```
to_pool     = fee_paid * reward_pool_bps / 10_000
to_creator  = fee_paid * creator_bps     / 10_000
to_protocol = fee_paid - to_pool - to_creator        (absorbs rounding)
```

`to_creator` is routed per `creator_share_target`.

No percentage is hard-coded; all values live in `FeePolicy` (core) and
`Arena.fee_policy` (program).

---

## 4. Arena Reward Pool

The Reward Pool is a USDC vault per Arena. It is funded by:

1. the reward-pool share of every Back fee,
2. **sponsored** deposits (`fund_reward_pool`, permissionless, tracked per
   sponsor),
3. protocol promotional deposits (same instruction, from the treasury),
4. creator deposits (same instruction),
5. **rollover** from a previous Arena between the same asset pair (TIE,
   unclaimed dust, capped remainders — see §6.4),
6. the **Upset Bonus** transferred from the protocol Upset Reserve at
   settlement (§7.3).

Principal is **never** part of this vault. Losing positions contribute nothing
at settlement; their fee was paid at entry like everyone else's.

Solvency invariant: the sum of all payouts is computed from a fixed
`pool_at_settlement` and shares that sum to ≤ 1, so
`Σ payouts ≤ pool_at_settlement` holds by construction (§6).

---

## 5. Time-weighted capital (the conviction accumulator)

### 5.1 Why an integral

A naive "capital at settlement" model lets a whale deposit in the final
minute and dominate. Tribe weights each position by the **integral of capital
over time**, so weight is proportional to _how much_ × _for how long_.

### 5.2 Per-position state (on-chain)

```
Position {
  units             u64    // raw units currently in the vault
  unit_seconds      u128   // ∫ units dt (raw, un-multiplied) — hold fraction and §7.4
  eff_units         u128   // Σ units_t × m_t over tranches (Q4 multiplier baked in)
  eff_unit_seconds  u128   // ∫ eff_units dt, accrued only inside [start_ts, end_ts]
  last_touch_ts     i64
  entry_ts          i64    // first deposit
  claimed           bool
}
```

`m_t` is the tranche's underdog multiplier in Q4 (10 000 = 1.0×), fixed at
deposit time (§7). `eff_units` therefore carries units × 10⁴ × multiplier.

### 5.3 Accrual

Before any mutation of a position or side (deposit, exit, settle), accrue:

```
now_clamped = clamp(now, start_ts, end_ts)
dt          = now_clamped - clamp(last_touch_ts, start_ts, end_ts)
eff_unit_seconds += eff_units * dt
last_touch_ts     = now
```

The same accrual is applied to the side-level aggregate:

```
Side {
  units             u64
  unit_seconds      u128   // ∫ units dt (for backing share TWAB)
  eff_units         u128
  eff_unit_seconds  u128   // Σ over positions; the reward denominator
  participants      u32
}
```

### 5.4 Deposit (Back / add backing)

```
require state == LIVE and now < backing_close_ts      // §5.6
accrue(position); accrue(side)
m = underdog_multiplier(side, units)                   // §7, Q4
position.units            += units
position.eff_units        += units * m
side.units                += units
side.eff_units            += units * m
```

### 5.5 Exit (full or partial)

Exiting `x` units of `u` held (`x ≤ u`) scales both the live weight and the
already accrued weight proportionally:

```
accrue(position); accrue(side)
keep_num = u - x ; keep_den = u
removed_eff          = position.eff_units        - position.eff_units        * keep_num / keep_den
removed_eff_seconds  = position.eff_unit_seconds - position.eff_unit_seconds * keep_num / keep_den
position.eff_units        -= removed_eff
position.eff_unit_seconds -= removed_eff_seconds
side.eff_units            -= removed_eff
side.eff_unit_seconds     -= removed_eff_seconds
position.units -= x ; side.units -= x
transfer x units vault -> user
```

A **full exit (`x == u`) before `end_ts` therefore forfeits all Arena Reward
weight** for the position (MVP rule). A partial exit forfeits the exited
proportion of both current and accrued weight. The data model supports
alternative rules later (e.g. keeping accrued weight with a decay) without
changing accounts — only the `removed_eff_seconds` rule changes.

After `end_ts`, exits and withdrawals no longer change any weight (accrual is
clamped at `end_ts`); users may withdraw before or after claiming.

### 5.6 Late entry

Backing closes at:

```
backing_close_ts = end_ts - min_hold_secs
min_hold_secs    = max(duration * min_hold_bps / 10_000, min_hold_floor_secs)
```

Defaults: `min_hold_bps = 1000` (10% of the Arena), `min_hold_floor_secs =
900` (15 min). The program rejects deposits after `backing_close_ts`; the UI
offers a plain Jupiter buy without an Arena Position instead. This removes
the "five minutes before settlement" entry entirely rather than merely
discounting it, and it defines the **LOCKED** state.

### 5.7 Sanity example

24-hour Arena, `min_hold` = 2.4 h.

| Position | Capital | Enters at  | Exits             | eff_unit_seconds (relative)             |
| -------- | ------- | ---------- | ----------------- | --------------------------------------- |
| Alice    | $1 000  | t = 0      | —                 | 1 000 × 86 400 = 86.4 M                 |
| Bob      | $10 000 | t = 20 h   | —                 | 10 000 × 14 400 = 144 M                 |
| Carol    | $50 000 | t = 21.7 h | —                 | **rejected** (backing closed at 21.6 h) |
| Dave     | $1 000  | t = 0      | full exit at 23 h | 0 (forfeit)                             |

Bob's 10× capital for 1/6 of the time earns 1.67× Alice's weight — linear in
capital-time, never dominated by timing alone. Carol cannot snipe. Dave
keeps his asset but earns nothing.

---

## 6. Reward distribution

At settlement the program freezes:

```
pool_at_settlement  = reward_vault.amount + upset_bonus                 (§7.3)
W_total             = winning_side.eff_unit_seconds (after final accrual at end_ts)
```

### 6.1 Per-position share

```
W_i        = position.eff_unit_seconds (after final accrual, winning side only)
share_i    = min( W_i * 10_000 / W_total , max_share_bps ) / 10_000      (u128 math, floor)
payout_i   = pool_at_settlement * W_i / W_total,  capped at pool_at_settlement * max_share_bps / 10_000
```

`max_share_bps` defaults to **2500** (no single position may take more than
25% of a pool). Because the cap is applied per position without
redistribution, `Σ payout_i ≤ pool_at_settlement` always holds and each claim
is O(1). The un-distributed remainder rolls over (§6.4).

### 6.2 Claim

```
require state == SETTLED and winner == position.side and !position.claimed
accrue(position, max(end_ts, position.last_touch_ts))   // frozen at end_ts; tolerant of post-end exits
require W_i > 0
position.claimed = true                    // set BEFORE transfer
transfer payout_i reward_vault -> user USDC account
emit RewardClaimed
```

Double-claim protection is the `claimed` flag on the position account, which
is a PDA of `(arena, side, user)`; there is exactly one such account per user
per side.

### 6.3 Ties and cancellations

- **TIE**: no winner, no Conviction change. Fee-derived pool and rollovers
  stay in the vault and roll over; sponsor deposits become refundable to
  their sponsor accounts.
- **CANCELLED**: identical treatment of the pool; all positions withdrawable
  at any time.

### 6.4 Rollover

Remainders (cap remainders, rounding dust, unclaimed rewards after
`claim_window_secs`, TIE pools) move to the **Rollover Pool** for the same
ordered asset pair `(mint_A, mint_B)`. The next Arena created for that pair
receives it at creation. If no such Arena exists after
`rollover_expiry_secs`, the treasury may sweep it into the Upset Reserve.

### 6.5 Worked example

BONK vs TSLAx, 24 h, BONK wins. `pool_at_settlement = 4 000 USDC`.

| Position           | W_i (M) | Raw share | Capped (25%) | Payout       |
| ------------------ | ------- | --------- | ------------ | ------------ |
| Alice              | 86.4    | 12.0%     | 12.0%        | 480.00       |
| Bob                | 144.0   | 20.0%     | 20.0%        | 800.00       |
| Erin (early whale) | 432.0   | 60.0%     | 25.0%        | 1 000.00     |
| Frank              | 57.6    | 8.0%      | 8.0%         | 320.00       |
| **Total**          | 720.0   | 100%      | 65%          | **2 600.00** |

1 400 USDC rolls over to the next BONK vs TSLAx Arena.

### 6.6 Cap behaviour comparison (Phase 1 findings; normative rule unchanged pending approval)

`packages/core/src/engine/distribution.ts` implements four behaviours on
identical inputs; `distribution.test.ts` and `distribution.json` record the
results. Rollover in USDC from a 4 000 USDC pool:

| Winners (weights)                      | A. HardCap 25 % | B. WaterFill 25 % | C. ConditionalCap | D. Proportional |
| -------------------------------------- | --------------- | ----------------- | ----------------- | --------------- |
| §6.5 example (86.4 / 144 / 432 / 57.6) | 1 400           | 0                 | 1 400             | 0               |
| lone winner                            | 3 000           | 3 000             | 0                 | 0               |
| two equal                              | 2 000           | 2 000             | 0                 | 0               |
| whale 90 + 5 + 5                       | 2 600           | 1 000             | 2 266             | 0               |
| twenty equal                           | 0               | 0                 | 0                 | 0               |

Findings:

1. **No per-position cap resists Sybil splitting.** Splitting a whale into
   four wallets defeats A, B and C alike (the wallets collectively receive
   more than the un-split whale). Proportional payout is split-neutral. A
   cap therefore only penalises honest single-wallet whales.
2. **A (Phase 0 default) causes unnecessary rollover** whenever there are
   fewer than four comparable winners — including the happy-path vector
   (46 % rolls) and a lone winner (75 % rolls).
3. **B pays out in full whenever it can** and is order-independent, but
   needs an O(n) pass over winners (fine off-chain and in the TS engine;
   not an O(1) on-chain `claim` without a settlement-time precomputation).
4. **C** fixes the lone-/two-winner cases but still rolls whenever one
   position dominates among ≥ 4 winners.

**Recommendation (pending approval):** set `max_share_bps = 10_000`
(proportional, D) as the default — it is the only split-neutral option,
has zero avoidable rollover, keeps `claim` O(1) on-chain, and the
time-weighting already limits late whales. Keep `max_share_bps` as a
creator-configurable knob for Arenas that want a visible "no single
winner takes more than X %" rule, implemented as B (WaterFill) computed by
the crank at settlement and stored per position. Until approved, the
engine default remains **A with 2 500 bps**.

---

## 7. Underdog multiplier

### 7.1 Definition

The **backing share** of a side is its USD share of total Arena backing.
Because every unit on a side is normalised at the same `P_start`, the share
can be computed from units:

```
usd(side)     = side.units        * P_start(side) / 10^d(side)          // instantaneous
usd_sec(side) = side.unit_seconds * P_start(side) / 10^d(side)          // time-weighted (TWAB)

share_inst_bps = usd(this)     * 10_000 / (usd(A)     + usd(B))         // AFTER adding the deposit
share_twab_bps = usd_sec(this) * 10_000 / (usd_sec(A) + usd_sec(B))     // BEFORE the deposit
share_eff_bps  = max(share_inst_bps, share_twab_bps)
```

When no time has accrued on either side yet (`usd_sec(A) + usd_sec(B) == 0`)
the TWAB is undefined and `share_eff_bps = share_inst_bps` alone; the
warm-up ramp (§7.2) then neutralises it. The first backer of an Arena has
`share_inst = 100 %` and therefore `1.0×`.

Exits do **not** rewrite the side's `unit_seconds` history: the TWAB is
the true integral of backing over time. Exits only reduce the _reward_
accumulators (`eff_units`, `eff_unit_seconds`) per §5.5.

The multiplier of a tranche is:

```
raw_m_q4 = clamp( 10_000 + slope * (5_000 - share_eff_bps) , 10_000 , cap_q4 )
```

Defaults: `slope = 2`, `cap_q4 = 20_000` (2.0×). Share 20% → 1.6×,
share 40% → 1.2×, share ≥ 50% → 1.0×.

### 7.2 Manipulation defences

Threat: a whale backs the _other_ side to make its own side look like the
underdog, backs its own side at a boosted multiplier, then exits the other
side.

1. **`max(instant, TWAB)`.** Any flash deposit on the other side lowers the
   instantaneous share immediately but barely moves the time-weighted share.
   The multiplier uses whichever is _less favourable_. To drag TWAB from 50%
   to 20% at hour 6 of a 24 h Arena, the attacker must hold 4× the existing
   backing on the other side for ≈18 h — real market exposure, real fees, and
   by then their own tranche has almost no time weight.
2. **Post-deposit instantaneous share.** The deposit that flips a side into
   the majority does not receive the underdog boost.
3. **Warm-up ramp.** Early in an Arena the TWAB is immature and equals the
   instantaneous share, so the boost ramps in linearly:

   ```
   warmup_secs = max(duration * warmup_bps / 10_000, warmup_floor_secs)   // 10%, 30 min
   elapsed     = now - start_ts
   m_q4        = 10_000 + (raw_m_q4 - 10_000) * min(elapsed, warmup_secs) / warmup_secs
   ```

   A manipulation in the first minutes yields ≈1.00×.

4. **Fees on both sides.** Backing the other side costs the full fee and the
   attacker's units on that side are forfeited from rewards on exit.
5. **Per-position share cap** (§6.1) bounds the payoff of any single
   manipulated position to 25% of the pool.
6. **Bounded upside.** The multiplier only redistributes _within_ the winning
   side and is capped at 2.0×. It never touches principal and it cannot make
   the pool larger by itself (only the Upset Bonus does, and that uses the
   whole-Arena TWAB, §7.3).

Residual risk and cost/benefit numbers are tracked in SECURITY.md §3.

### 7.3 Upset Bonus (pool level)

At settlement, the winner's **whole-Arena** TWAB share is computed:

```
twab_share_winner_bps = usd_sec(winner) * 10_000 / (usd_sec(A) + usd_sec(B))
m_upset_q4            = clamp(10_000 + slope * (5_000 - twab_share_winner_bps), 10_000, cap_q4)
upset_bonus           = min( base_pool * (m_upset_q4 - 10_000) / 10_000,
                             upset_reserve.amount * reserve_draw_bps / 10_000,
                             upset_bonus_cap_usdc )
```

Limits are applied in the order: reserve balance, reserve draw, absolute
cap — so the bonus can never exceed what the reserve actually holds, and a
zero reserve yields a zero bonus explicitly (`limited_by = reserve_balance`).

The bonus is transferred from the protocol **Upset Reserve** (funded from the
protocol fee share) into the Arena reward vault before `pool_at_settlement`
is frozen. When the crowd is wrong, the pool gets bigger; when the favourite
wins, nothing changes. Distorting a whole-Arena integral is the most
expensive manipulation in the system.

### 7.4 Proposal (not yet adopted): settlement clamp on entry-time boosts

Phase 1 simulation S12 (SECURITY §3) shows that in long Arenas an attacker
holding 10× the honest backing on the opposite side for one day can still
lock in ≈1.31× on a later tranche. A deterministic, O(1) hardening is
implemented in `packages/core` behind `ArenaConfig.underdogSettlementClamp`
(default **off**, i.e. Phase 0 behaviour):

```
m_settle_q4 = clamp(10_000 + slope * (5_000 - twab_share_winner_bps), 10_000, cap_q4)   // same as m_upset
W_i         = min( eff_unit_seconds_i , unit_seconds_i * m_settle_q4 )
```

A tranche can never earn more boost than the whole-Arena underdog status of
its side justifies; honest 1.0× positions are unaffected (up to exit-rounding
dust < 10⁴ unit-seconds). On-chain cost: one extra `u128` per position
(`unit_seconds`, already added). The denominator `W_total` under the clamp
is `Σ_i W_i`, which requires either an O(n) pass at settlement or the safe
approximation `min(side.eff_unit_seconds, side.unit_seconds × m_settle)`
(≥ the true sum ⇒ payouts still sum to ≤ pool, remainder rolls over).
**Adoption requires approval; see the Phase 1 report.**

---

## 8. Existing-holder entry

A wallet already holding an Arena asset may commit any amount `units ≤
balance` as an Arena Position. The program moves exactly `units` into the
position vault; the rest of the wallet is untouched. The entry is recorded
with `entry_kind = ExistingHoldings` (vs `UsdcSwap`) for analytics, but the
economics — fee, multiplier, time weighting — are identical to a USDC entry
of the same size, so neither path is privileged.

---

## 9. Victory Roll

After a win, a position offers **CLAIM REWARD** and **VICTORY ROLL**.

Victory Roll = claim + Jupiter swap (USDC → winning asset) [+ Back into the
next compatible Arena], composed into one transaction where size permits,
otherwise sequenced. The original winning position is never sold by the
protocol; the user chooses independently to keep, withdraw, sell, or re-enter
with existing holdings.

---

## 10. Sponsored Arenas

Any wallet may call `fund_reward_pool(arena, usdc)`. Deposits are tracked in
a `Sponsor` account `(arena, sponsor)`. Sponsors are displayed on the Arena.
On TIE or CANCELLED the sponsor may reclaim their deposit; on SETTLED it is
part of the pool. Sponsors get no influence over settlement.

---

## 11. Conviction Score and reputation (off-chain, deterministic)

Computed by the indexer from on-chain events only, so anyone can recompute it.

Per settled, reward-eligible position (not fully exited):

```
capital_tier = clamp( floor(log10(max(notional_start_usd, 10))) , 1 , 5 )
hold_frac    = eff_unit_seconds / (eff_units_final * duration)          // ∈ (0, 1]
upset        = m_upset_q4 / 10_000                                       // winner-side TWAB multiplier

win  : points = +100 * capital_tier * hold_frac * upset * streak_bonus
loss : points =  -50 * capital_tier * hold_frac
tie / cancelled : 0
```

`streak_bonus = 1 + 0.05 * min(current_streak, 5)` (cap +25%), applied to
positive points only. Conviction Score is the running sum, displayed floored
at 0. Streaks never change reward payouts; they only affect reputation.

Tracked per user: Arenas entered, Arenas won, win rate, average hold
duration, total Backing, total Arena Rewards, biggest upset (highest
`m_upset` on a win), current streak, best streak, Conviction Score.

Leaderboard eligibility: win-rate boards require ≥ 5 settled Arenas with
`notional_start ≥ 50 USDC` each. Creator boards count only Arenas that
reached SETTLED with ≥ 10 distinct participants.

---

## 12. Parameter registry (defaults)

| Key                                            | Default            | Scope    |
| ---------------------------------------------- | ------------------ | -------- |
| `fee_bps`                                      | 50                 | policy   |
| `reward_pool_bps / protocol_bps / creator_bps` | 4000 / 4000 / 2000 | policy   |
| `tie_bps`                                      | 1                  | Arena    |
| `min_hold_bps`, `min_hold_floor_secs`          | 1000, 900          | Arena    |
| `warmup_bps`, `warmup_floor_secs`              | 1000, 1800         | Arena    |
| `underdog_slope`, `underdog_cap_q4`            | 2, 20 000          | Arena    |
| `max_share_bps`                                | 2500               | Arena    |
| `reserve_draw_bps`, `upset_bonus_cap_usdc`     | 1000, 5 000 USDC   | protocol |
| `claim_window_secs`                            | 30 days            | protocol |
| `settlement_grace_secs`                        | 6 h                | Arena    |
| `min_backing_usdc`                             | 5 USDC             | Arena    |
| `min_duration_secs`, `max_duration_secs`       | 1 h, 30 days       | protocol |

All parameters are validated by `packages/core` (`ArenaConfigSchema`) and
mirrored in the program's `ProtocolConfig` / `Arena` accounts.

# Tribe — Arena State Machine

> **Status:** Source of truth for Arena lifecycle. The on-chain program is the
> authority for every state except `DRAFT`; the indexer mirrors program state
> and never invents transitions.

---

## 1. States

```
                 create_arena
   DRAFT ─────────────────────▶ SCHEDULED
 (off-chain)                        │
                                    │ snapshot_start  (t ≥ start_ts)
                                    ▼
                                  LIVE ──────────────────────────────┐
                                    │  t ≥ backing_close_ts          │
                                    ▼                                │
                                 LOCKED                              │
                                    │  t ≥ end_ts                    │
                                    ▼                                │ cancel_arena /
                                 ENDING ── settle ──▶ SETTLED        │ cancel_expired
                                    │                (winner | TIE)  │
                                    │                                ▼
                                    └───────────────────────────▶ CANCELLED
```

| State | Stored on-chain as | Meaning |
| --- | --- | --- |
| **DRAFT** | — (indexer only) | Creator is composing an Arena in the UI. Nothing exists on-chain. |
| **SCHEDULED** | `status = Scheduled` | Arena account, vaults and parameters exist. Start snapshot not yet taken. No backing allowed. |
| **LIVE** | `status = Live` | Start prices snapshotted. Backing, adding, and exiting allowed. Accrual running. |
| **LOCKED** | derived: `Live && now ≥ backing_close_ts` | Backing closed. Exits still allowed. Accrual running. |
| **ENDING** | derived: `Live && now ≥ end_ts` | Accrual frozen at `end_ts`. Awaiting settlement prices. Exits allowed (no weight change). |
| **SETTLING** | — (indexer/crank only) | The settlement transaction is being assembled and sent. |
| **SETTLED** | `status = Settled` | Winner (or TIE) recorded with settlement prices; pool frozen; claims open. |
| **CANCELLED** | `status = Cancelled` | Arena void. No rewards. Positions withdrawable; sponsors refundable. |

`LOCKED` and `ENDING` are **derived** from timestamps rather than stored, so
no transaction is required to enter them and no crank can be late. The
program checks `now` against `backing_close_ts` and `end_ts` inside each
instruction.

## 2. Arena parameters fixed at creation

| Field | Type | Description |
| --- | --- | --- |
| `creator` | Pubkey | Arena Creator. |
| `asset_a`, `asset_b` | `AssetRef` | Registry entries: mint, token program, decimals, price feed id, asset class, staleness policy, scaled-UI flag. |
| `start_ts`, `end_ts` | i64 | Window. `end_ts - start_ts ∈ [min_duration, max_duration]`. |
| `backing_close_ts` | i64 | `end_ts - min_hold_secs` (ECONOMICS §5.6). |
| `settlement_grace_secs` | u32 | How long after `end_ts` settlement may be attempted before permissionless cancellation. |
| `fee_policy` | struct | Snapshot of `FeePolicy` at creation (ECONOMICS §3). |
| `underdog`, `tie_bps`, `max_share_bps`, warm-up | struct | ECONOMICS §7, §2, §6. |
| `title`, `description_uri` | string | Metadata (short on-chain title, URI to indexer/IPFS for the rest). |
| `sponsor_open` | bool | Whether `fund_reward_pool` is permissionless. |
| `creation_bond` | u64 | Lamports held until SETTLED/CANCELLED to deter spam. |

Both assets must be **active** in the on-chain Asset Registry at creation
(ARCHITECTURE §6). Creation is permissionless over the registry.

## 3. Transitions

### 3.1 `create_arena` — DRAFT → SCHEDULED

- Signer: creator. Pays rent + creation bond.
- Validates parameters, registry status of both assets, `start_ts ≥ now +
  min_lead_secs` (default 5 min), `asset_a ≠ asset_b`.
- Creates: `Arena`, two `Side` records (inline), reward USDC vault (PDA),
  position vault ATAs are created lazily per user.
- Receives any Rollover Pool for the ordered pair.
- Emits `ArenaCreated`.

### 3.2 `snapshot_start` — SCHEDULED → LIVE

- Signer: anyone (permissionless crank; Tribe runs one).
- Requires `now ≥ start_ts`.
- Requires two Pyth `PriceUpdateV2` accounts, one per side, verified
  (ARCHITECTURE §5.3) with `publish_time` inside the **start window**:

  ```
  start_ts - snapshot_tolerance_secs(asset) ≤ publish_time ≤ start_ts + snapshot_tolerance_secs(asset)
  ```

  or, for assets whose class allows `LastKnown` (equities outside market
  hours), the last publish **before** `start_ts` no older than
  `max_closed_staleness_secs`. The chosen mode is stored per side
  (`price_mode = Exact | LastKnown`).
- For `ScaledUi` assets, reads the mint's current multiplier and stores
  `mult_start_q6`; `P_start = P_pyth × mult / 1e6` (ECONOMICS §0.1).
- Rejects if the Pyth confidence interval is wider than
  `max_conf_bps` of the price (default 100 bps crypto, 50 bps equity).
- Stores `P_start[A|B]`, `publish_ts[A|B]`, `price_mode[A|B]`,
  `snapshot_start_ts = now`. Emits `ArenaStarted`.

If `snapshot_start` cannot be performed within `start_ts +
settlement_grace_secs`, `cancel_expired` becomes callable (§3.8).

### 3.3 `back` / `add_backing` — LIVE only

- Requires `status == Live && now < backing_close_ts`.
- Requires `notional ≥ min_backing_usdc` and `fee_paid ≥ fee_required`.
- Transfers units to the position vault (Token-2022 aware `transfer_checked`),
  routes fees, updates accumulators (ECONOMICS §5.4, §7).
- Emits `Backed { entry_kind, units, fee, multiplier_q4 }`.

### 3.4 `exit` — LIVE, LOCKED, ENDING, SETTLED, CANCELLED

- Signer: position owner only.
- Always allowed; never blocked by Arena state. If the token mint is paused
  (Token-2022 `pausable`), the transfer fails at the token program and the
  user retries later — the program itself never blocks withdrawal.
- Weight consequences per ECONOMICS §5.5 (none after `end_ts`).
- Emits `Exited`.

### 3.5 `fund_reward_pool` — SCHEDULED, LIVE, LOCKED

- Permissionless if `sponsor_open`, otherwise creator/protocol only.
- Not allowed after `end_ts` (pool must be knowable to participants before
  the whistle).
- Emits `PoolFunded { sponsor, amount }`.

### 3.6 `settle` — ENDING → SETTLED

- Signer: anyone (permissionless crank).
- Requires `now ≥ end_ts` and `now ≤ end_ts + settlement_grace_secs +
  extensions`.
- Requires two verified Pyth price updates with `publish_time` inside the
  **end window** (same rule as §3.2 around `end_ts`), with `LastKnown`
  allowed for equity assets outside market hours **only if the start
  snapshot of that side was also within the same trading session or the
  Arena was created with `allow_closed_settlement = true`** (UI surfaces
  this prominently — see §5.2).
- Reads `mult_end_q6` for `ScaledUi` assets.
- Performs final accrual at `end_ts` for both sides.
- Computes winner or TIE (ECONOMICS §2), Upset Bonus (ECONOMICS §7.3),
  freezes `pool_at_settlement` and `W_total`.
- Emits `ArenaSettled { winner, perf_a_bps, perf_b_bps, pool, upset_bonus }`.

### 3.7 `claim` — SETTLED

- Position owner, winning side, `claimed == false`. Pays `payout_i`
  (ECONOMICS §6). Emits `RewardClaimed`.
- After `claim_window_secs`, `sweep_unclaimed` moves the remainder to the
  Rollover Pool.

### 3.8 `cancel_arena` / `cancel_expired` — → CANCELLED

`cancel_arena` (protocol authority, multisig in production) may be called
from SCHEDULED, LIVE, LOCKED, or ENDING when a **cancellation condition**
holds:

| Condition | Detection |
| --- | --- |
| An asset is suspended in the registry (delisted, halted, oracle retired). | registry flag |
| Price source failed for one side beyond the grace window. | crank alert |
| Mint became non-transferable for the duration (paused / transfer hook set). | on-chain check |
| Corporate action of an unsupported kind (§5.3). | xStocks API + registry |
| Duplicate / erroneous creation. | manual |

Every authority cancellation emits `ArenaCancelled { reason }` and is shown in
the UI with the reason.

`cancel_expired` is **permissionless**: callable by anyone if the Arena is
SCHEDULED past `start_ts + settlement_grace_secs` without a start snapshot,
or ENDING past `end_ts + settlement_grace_secs + extensions` without
settlement. This guarantees funds can never be stranded by an absent
authority or a dead crank.

### 3.9 `extend_settlement` — ENDING

Authority may extend the grace window **once**, by at most
`max_extension_secs` (default 24 h), with a stored reason (e.g. a US market
holiday closing the equity feed). Emits `SettlementExtended`.

## 4. Sources of truth

| Question | Source |
| --- | --- |
| Arena state, prices, winner, weights, pool | `Arena` account (program) |
| Reference prices | Pyth `PriceUpdateV2` accounts verified by the program, feed ids fixed in the registry |
| xStocks multiplier | Mint `ScaledUiAmount` extension at snapshot time |
| Market hours / halts / corporate actions | xStocks public API + Pyth `market_hours`, consumed by the crank and UI; **advisory**, never a settlement input |
| Display prices between snapshots | Pyth (via Tribe API proxy) with Jupiter Price v3 as display fallback, labelled |
| Participant counts, activity, leaderboards | Indexer built from program events |

## 5. Edge cases

### 5.1 Invalid, failed or stale oracle data

- A `PriceUpdateV2` whose `feed_id` does not match the registry entry,
  whose verification level is not `Full`, whose `publish_time` is outside
  the window, or whose confidence exceeds `max_conf_bps` is rejected;
  the instruction fails and no state changes.
- Because Pyth Hermes serves updates **by publish time**, the crank can fetch
  the update published at exactly `end_ts` even hours later. Late cranking
  therefore never changes the settlement price; it only delays it.
- If no acceptable update exists (feed outage), the crank alerts; the
  authority may `extend_settlement` once; otherwise `cancel_expired`.

### 5.2 xStocks market closures (24/5 tokens, RTH oracles)

Pyth US-equity feeds publish during regular trading hours
(`America/New_York 09:30–16:00`). Tokenised stocks trade on-chain 24/7 and
xStocks issuance runs 24/5, so a stock side's reference price can be
**frozen** while the crypto side moves.

Rules:

1. Registry assets of class `Equity` carry `market_hours` (from Pyth) and
   `max_closed_staleness_secs` (default 72 h, covering a weekend).
2. The Create Arena flow **defaults `start_ts` and `end_ts` for
   equity-containing Arenas to RTH** and shows a "Market-hours Arena" badge.
3. Creators may opt into `allow_closed_settlement`. The Arena page then shows
   a persistent notice: *"TSLAx reference price updates only during US
   market hours (09:30–16:00 ET). Outside those hours its performance is
   frozen at the last official price."*
4. Settlement in `LastKnown` mode records `price_mode = LastKnown` per side
   and the UI labels the settlement price "last close".
5. US market holidays are handled by the same mechanism (staleness ≤ 72 h;
   longer closures → `extend_settlement` or cancel).

### 5.3 Corporate actions

xStocks express dividends, splits and reverse splits through the mint's
`ScaledUiAmount` multiplier, activated at 00:30 UTC the day after the
ex-date, with `newMultiplier` and `newMultiplierEffectiveTimestamp` published
on the mint in advance.

- Reference prices are always `P_underlying × multiplier`, so a split or a
  reinvested dividend is price-continuous and requires no intervention.
- The crank reads `newMultiplierEffectiveTimestamp`; if an activation falls
  inside `[start_ts, end_ts]`, the Arena page shows a corporate-action notice
  and the crank refuses to snapshot **within ±10 min of the activation
  timestamp** (as xStocks advises venues to pause), retrying after.
- Unsupported events (delisting, merger, symbol change, oracle retirement)
  are surfaced by the xStocks API and the registry; the authority cancels
  the Arena (§3.8).

### 5.4 Asset suspension / pause / halt

- `isTradingHalted` (xStocks) or a halted underlying: Pyth stops publishing.
  Settlement waits within the grace window, then extend or cancel.
- Token-2022 `pausable` pause: deposits and exits fail at the token program.
  The Arena keeps running (prices come from Pyth, not from transfers);
  exits resume when unpaused. A pause lasting through the grace window is a
  cancellation condition.
- A `transfer_hook` program appearing on a registry mint sets the asset to
  `Suspended` in the registry until reviewed.

### 5.5 Ties

`|Δ| ≤ tie_bps` (ECONOMICS §2). No winner, no Conviction change, pool rolls
over, sponsors refundable. Displayed as **DRAW**.

### 5.6 Reward claims

Claims are open from SETTLED for `claim_window_secs`; unclaimed rewards roll
over afterwards. Claiming never requires withdrawing the asset.

### 5.7 Clock

The program uses `Clock::get()?.unix_timestamp`. All windows have tolerances
of at least 60 s so validator clock drift cannot invalidate a correct crank.

## 6. Invariants (tested)

1. Every reachable state has a path to `SETTLED` or `CANCELLED` with no
   privileged signer required (`cancel_expired`).
2. Position units never change except by the owner's own `back`/`exit`.
3. `Σ side.eff_unit_seconds == Σ positions.eff_unit_seconds` at all times.
4. Accrual never counts time outside `[start_ts, end_ts]`.
5. `Σ claims ≤ pool_at_settlement`.
6. A position can claim at most once.
7. Settlement prices depend only on `(feed_id, end_ts window)`, never on
   *when* the settle transaction lands.

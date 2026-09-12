# Tribe core test vectors

Versioned, language-neutral vectors generated from the `@tribe/core`
reference implementation. The Anchor program (Phase 2) must reproduce every
`expected` block bit-for-bit.

- Schema: `tribe-core-vectors`, version `1`.
- **All integers are decimal strings** (`"36525000000"`). Parse with
  `u64/u128/i64/i128::from_str`. JSON numbers are only used for small
  configuration values (`bps`, `decimals`, `expo`).
- `null` means "absent" (e.g. `shareTwabBps` when no time has accrued).
- Error outcomes are `ErrorCode` identifiers from `src/engine/errors.ts`
  and must map one-to-one onto the program's `#[error_code]` variants.

| File                | Vectors | Covers                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `math.json`         | 17      | Q8 normalisation, ScaledUi reference price, notional, `perf_bps`, division-free winner rule with tie band                                                                                                                                                                                              |
| `accrual.json`      | 9       | window clamping, repeated accrual, multi-tranche multipliers, partial/full exits, post-end exits, rounding, u128 boundary                                                                                                                                                                              |
| `underdog.json`     | 9       | instant vs TWAB shares, warm-up ramp, cap, majority side, short-arena floor, custom policy                                                                                                                                                                                                             |
| `fees.json`         | 10      | fee floor, exact split with rounding absorbed by protocol, creator routing, tiny and u64-scale notionals                                                                                                                                                                                               |
| `oracle.json`       | 18      | feed mismatch, verification level, sign, confidence, exact window, LastKnown rules, multiplier, exponent and overflow bounds                                                                                                                                                                           |
| `settlement.json`   | 10      | equal returns, ±1 bps boundary, zero/wide bands, extreme ratios, split continuity                                                                                                                                                                                                                      |
| `distribution.json` | 20      | internal comparison utilities (HardCap / WaterFill / ConditionalCap / Proportional) on identical inputs — Proportional is normative                                                                                                                                                                    |
| `upset.json`        | 8       | formula, reserve balance, draw limit, absolute cap, empty reserve, zero pool                                                                                                                                                                                                                           |
| `arena.json`        | 11      | full event streams: happy path, TIE + sponsor refund + sweep, guard rejections, cancel-expired, extension + authority cancel, S12 attack clamped, honest underdog with upset bonus, favourite wins (all clamped to 1.0×), short arena, proportional payout with rollover, ScaledUi split at settlement |

## Regenerating

```bash
pnpm --filter @tribe/core vectors   # rewrites test-vectors/*.json from the engine
pnpm --filter @tribe/core test      # src/vectors/vectors.test.ts replays every file
```

The replay test fails whenever the engine and the committed vectors
disagree, so a behavioural change must be accompanied by regenerated
vectors in the same commit — and the diff shows exactly which expected
values moved.

## `arena.json` shape

```
inputs: { config, createdAt, rolloverIn, events[], claimAt }
expected: {
  status, phaseAtClaim, backingCloseTs, startPrices, endPrices, settlement | null,
  cancelReason | null, rewardVault, protocolFees, creatorFees, sponsorTotal,
  rolloverIn, rolloverOut, totalClaimed,
  sides: { A: {units, unitSeconds, effUnits, effUnitSeconds, participants}, B },
  positions: { "<side>:<owner>": { units, unitSeconds, effUnits, effUnitSeconds,
               claimed, forfeited, feePaid, rewardWeight | null, payout | ErrorCode | null } },
  trace: [ { index, type, ok: true, effects[] } | { index, type, ok: false, error: ErrorCode } ]
}
```

`rewardWeight` and `payout` are computed for winning-side positions by
applying a `claim` at `claimAt` to the final state (each independently, so
payouts do not depend on claim order).

# Hermes posting interface (specified, not implemented)

Status: **design only**. The crank does not post Pyth updates yet; it emits
`needs_hermes` and waits. This page pins down the exact interface so the
work can be done after the SOL vs BONK canary without touching the program.

## Why it is needed

On mainnet only crypto feeds are kept fresh in the sponsored push-oracle
accounts (`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, shard 0). xStocks
feeds (TSLAx, SPYx, NVDAx, …) are days stale there (MAINNET_CUTOVER §2), so
any Arena with an equity side cannot pass the program's staleness /
tolerance checks at `snapshot_start` or `settle` unless a fresh
`PriceUpdateV2` account is posted first. BONK vs TSLAx depends on this.

## What the program already accepts

`snapshot_start` and `settle` take two `price_update` accounts (one per
side) and check, per side (`engine/oracle.rs`):

- owner = Pyth receiver program (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`),
  discriminator `PriceUpdateV2`;
- `feed_id` equals the registry entry's feed id;
- `verification_level == Full`;
- `|publish_time − target_ts| ≤ tolerance_secs` (target = `start_ts` or
  `end_ts`, **not** the crank's submission time);
- `conf / price ≤ max_conf_bps`; price > 0; exponent normalised to Q10.

Nothing in the program cares whether the account is a sponsored push-oracle
PDA or an ephemeral account the crank posted. So no program change is
required; the interface below is entirely crank-side.

## Interface

### Inputs

| Name                  | Where                                    | Notes                                                                            |
| --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `PYTH_HERMES_URL`     | crank env                                | `https://pyth.dourolabs.app/hermes` (keyed) or a self-hosted Hermes              |
| `PYTH_HERMES_API_KEY` | crank env (secret)                       | `Authorization: Bearer …`; required since 2026-08-26 on the hosted endpoint      |
| feed ids              | `AssetEntry.feed_id` (on-chain registry) | 32-byte hex, same ids the program verifies against                               |
| target publish time   | `Arena.start_ts` / `Arena.end_ts`        | the crank fetches the update **at** that time, so late settlement is still exact |
| `CRANK_KEYPAIR`       | crank env (secret)                       | pays the post + the Tribe instruction; needs ≈ 0.02 SOL working balance          |

### Step 1 — fetch the update at the target time

```
GET {PYTH_HERMES_URL}/v2/updates/price/{target_ts}
    ?ids[]=<feed_id_a>&ids[]=<feed_id_b>&encoding=base64&parsed=true
Authorization: Bearer {PYTH_HERMES_API_KEY}
```

Response `binary.data[]` is the VAA/merkle payload (base64); `parsed[]`
carries `price.publish_time`, which the crank checks against the tolerance
window **before** spending anything (`feedAcceptable` in `crank.ts` already
implements the rule on `FeedSnapshot`; reuse it on the parsed value).

Client library: `@pythnetwork/hermes-client` 3.x
(`HermesClient.getPriceUpdatesAtTimestamp(ts, ids, { encoding: 'base64' })`),
constructed with `{ headers: { Authorization: 'Bearer …' } }`.

### Step 2 — post to the receiver

`@pythnetwork/pyth-solana-receiver` 0.16:

```ts
const receiver = new PythSolanaReceiver({ connection, wallet: crankWallet });
const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
await builder.addPostPriceUpdates(binaryData); // one ephemeral PriceUpdateV2 per feed
await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) => [
  // the Tribe instruction, with the two ephemeral accounts as `price_update_a/b`
  await client.snapshotStartIx(
    cranker,
    arena,
    getPriceUpdateAccount(feedIdA),
    getPriceUpdateAccount(feedIdB),
  ),
]);
const txs = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50_000 });
```

- `addPostPriceUpdates` uses `post_update` (full verification through the
  Wormhole guardian set; ≈ 2 transactions per feed because the VAA must be
  written to an encoded-VAA account first). `post_update_atomic` is one
  transaction but yields `verification_level = Partial`, which the program
  rejects by design; **keep `Full`**.
- `closeUpdateAccounts: true` appends the close instructions so the
  rent (≈ 0.0077 SOL per `PriceUpdateV2`, plus the encoded-VAA account)
  comes back to the crank in the same batch.
- The Tribe instruction rides in the last transaction of the batch, so
  the ephemeral accounts exist exactly when `snapshot_start` / `settle`
  reads them.

### Step 3 — crank hook

`crank.ts` already returns `{ kind: 'needs_hermes', arena, step, reason }`
when a sponsored feed is unusable for the target time. The implementation
replaces the current "log and wait" branch with:

1. fetch (step 1); if the parsed publish time is outside the tolerance
   window, log and keep waiting (the sponsored account may still catch up);
2. post + consume (step 2) in one batch;
3. on any failure the Arena is untouched; the batch is idempotent and can
   be retried until `end_ts + grace + extension`, after which the existing
   `cancel_expired` path applies.

`snapshotStartIx` / `settleIx` (instruction builders returning
`TransactionInstruction` instead of sending) are the only additions the
client needs; `snapshotStart` / `settle` keep their current signatures.

### Costs (mainnet, measured 2026-09-14)

Per Arena with two posted feeds: 2 × (`post_update` ≈ 0.0002 SOL fees +
rent round-trip) ≈ 0.001 SOL net, twice (start and end). Priority fee
dominates. The crank wallet budget in MAINNET_CUTOVER (0.1 SOL) covers
≈ 40 posted Arenas.

### Security notes

- The key never leaves the crank environment; the browser keeps talking to
  `/api/oracle/*` for display only.
- Posting does not change what the program trusts: a wrong or replayed VAA
  fails the receiver's guardian verification, and a stale one fails the
  program's tolerance check. The crank cannot choose a price; it can only
  choose _whether_ to submit the update at the target time.
- `feedAcceptable` is applied before posting so a stale Hermes answer is
  never paid for.

## Not in scope until after the canary

The SOL vs BONK canary uses sponsored feeds only. Hermes posting is wired
after the canary settles, then TSLAx is registered and BONK vs TSLAx
becomes the showcase Arena (MAINNET_CUTOVER §6 step 10).

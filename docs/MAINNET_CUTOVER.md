# Mainnet cutover — readiness review and checklist

> Status 2026-09-15: **review complete, M1 resolved (Q10), nothing deployed
> to mainnet.** The devnet deployment (`docs/DEPLOYMENTS.md`) proved the
> program; this document is the gate for the first mainnet canary. Nothing
> here has been executed against mainnet; every "verified" item below was
> read from live mainnet data without signing anything.

## 1. Program review at HEAD (`programs/tribe_arena`, commit `9bee008`)

Re-read instruction by instruction (config, arena, position, engine, token).

| Area                           | Result                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDA derivation                 | Distinct literal seeds, creator+nonce for Arenas, arena+side+owner for Positions, bumps stored and re-checked. No collision path.                                                                                                                                                                                          |
| Vault authority                | Position vault = ATA of the Position PDA, only `exit` signs with it, only to an account whose authority is the owner. Reward vault = ATA of the Arena PDA, drained only by `claim` (to claimant), `refund_sponsor` (to sponsor), `sweep_unclaimed` (to treasury). Reserve = ATA of the config PDA, only `settle` moves it. |
| Token transfers                | All `transfer_checked` with mint + decimals; Token-2022 and legacy handled through the interface types; fee legs pinned by `address =`.                                                                                                                                                                                    |
| Token-2022 policy              | Rejects TransferFeeConfig, NonTransferable, InterestBearingConfig, active transfer hook. Accepts PermanentDelegate, Pausable, DefaultAccountState, ConfidentialTransfer (unused), ScaledUiAmount (multiplier read on-chain, `new_multiplier` honoured after its effective timestamp).                                      |
| Fees / rewards / sponsors      | Fee ≥ required enforced; split sums exactly; pool balance ≤ vault; claims floor and never exceed pool; sponsor refunds bounded by pool; sweep leaves refundable sponsor money on ties.                                                                                                                                     |
| Exit / claim / settle / cancel | Exit only by owner, forfeits weight only while live before end; claim requires Settled + winning side + not claimed, sets `claimed` before the CPI; settle guarded by status, window and validated prices; cancel_expired permissionless with grace.                                                                       |
| Integer math                   | Checked u128 / U256 `mul_div` everywhere; release `overflow-checks = true`; Q10 normalisation bounds; winner rule in U256.                                                                                                                                                                                                 |
| Oracle validation              | Feed id, Full verification, confidence bps, publish-time window (Exact / LastKnown for non-crypto), receiver-owned `PriceUpdateV2` via the SDK type.                                                                                                                                                                       |
| Replay / double claim          | `claimed`, `refunded`, `claims_swept_at`, status transitions.                                                                                                                                                                                                                                                              |
| Signers                        | Owner for back/exit/claim, authority (has_one) for admin, anyone for cranks by design.                                                                                                                                                                                                                                     |
| Account injection              | Every account is typed or address-pinned; the only `UncheckedAccount`s are the address-pinned USDC fee legs. `remaining_accounts` unused.                                                                                                                                                                                  |
| Pause                          | Gates `create_arena` and `back` only — exits, settlement, claims, refunds keep working.                                                                                                                                                                                                                                    |
| Rent / closing                 | No account closing (positions and vault ATAs stay; ~0.0032 SOL per position). Cancelled Arenas keep the fee-pool remainder in the vault (no sweep path for Cancelled).                                                                                                                                                     |

### Findings

| #   | Severity                  | Finding                                                                                                                                                                                                                                                                     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **High → resolved (Q10)** | **Q8 price scale is too coarse for sub-cent assets.** Live BONK is $0.00000271 → `price_q8 = 271`, so Arena performance for BONK was quantised in ~0.37 % steps and the 1 bps tie band was meaningless. SOL, xStocks and anything ≥ $0.01 were fine.                        | **Done (commit `04d16d5`): reference prices are Q10** (USD × 1e10, BONK = 27 100, five significant digits). Core, Rust engine, vectors, IDL, client and web migrated; economics proven byte-identical by `q10-equivalence.test.ts`; BONK precision, tie-band and headroom tests in `fixed.test.ts` and `math.rs`. Devnet redeploy of the Q10 build is prepared but pending devnet SOL (DEPLOYMENTS.md). Q10 headroom: u64 price cap ≈ $1.84 × 10⁹, winner rule in U256. |
| M2  | Medium (operational)      | Within the tolerance window a cranker may pick the most favourable print (±120 s). Bounded by tolerance × asset volatility; the crank is ours.                                                                                                                              | Register with 120 s tolerance; document.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M3  | Medium (client)           | `back` pays the creator share to the creator's USDC ATA; if it does not exist every `back` on that Arena fails.                                                                                                                                                             | Fixed in the client: `/api/protocol/back` prepends idempotent ATA creation (payer = backer); Create Arena will create it up front.                                                                                                                                                                                                                                                                                                                                      |
| M4  | Low (UI trust)            | `first_party` is a creator-chosen flag that only routes the creator's own fee share; the UI used it for the "Tribe" badge.                                                                                                                                                  | Fixed: the badge now requires `creator == config.authority`. Program unchanged.                                                                                                                                                                                                                                                                                                                                                                                         |
| M5  | Low                       | Fee-pool remainder of a cancelled Arena is locked in the vault (no sweep for Cancelled).                                                                                                                                                                                    | Post-hackathon: add `sweep_cancelled` (treasury). Amounts are 40 % of 0.5 % fees.                                                                                                                                                                                                                                                                                                                                                                                       |
| M6  | Low                       | No account closing → rent stays in Position/vault accounts.                                                                                                                                                                                                                 | Post-hackathon `close_position`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| M7  | Info                      | Issuer powers on xStocks (PermanentDelegate, freeze, Pausable, future transfer hook) can freeze or seize vault balances; inherent to the asset.                                                                                                                             | Disclose in risk copy; keep xStocks out of the first canary.                                                                                                                                                                                                                                                                                                                                                                                                            |
| M8  | Info                      | Client-side intent check added: the wallet only signs server-built transactions whose programs are {Tribe, ATA, ComputeBudget}, whose Tribe instructions reference the expected Arena and owner, and whose fee payer is the wallet (`apps/web/src/lib/protocol/verify.ts`). | Done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

No arbitrary-account injection, replay, double-claim, principal-mixing or authority-bypass path was found. M1 was the only finding blocking a BONK Arena; it is resolved.

| M9 | Info | Two-step mainnet Back (Jupiter buy → Tribe Back) is never atomic. The client verifies the Jupiter transaction (fee payer, single signer, program whitelist incl. lookup-table-resolved programs), measures the received amount as a balance delta, and keeps a pending record so a failed Back can be retried without a second buy (`apps/web/src/components/back/TwoStepBack.tsx`). | Done; covered by `two-step.test.tsx`. |
| M10 | Info | Native SOL Backs wrap in the Back transaction; the intent check only allows a transfer owner → owner's wSOL ATA, `syncNative` on it, and (Exit) `closeAccount` of it back to the owner. | Done; `verify.test.ts`. |

## 2. Verified mainnet facts (live reads, 2026-09-14 00:10–01:40 UTC)

| Asset      | Mint                                           | Program    | Dec | Extensions                                                                                                                                                        | Sponsored Pyth account                                                                                      | Policy result now                             |
| ---------- | ---------------------------------------------- | ---------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| USDC       | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Token      | 6   | —                                                                                                                                                                 | —                                                                                                           | canonical Circle USDC ✓                       |
| BONK       | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` | Token      | 5   | — (no mint/freeze authority)                                                                                                                                      | `DBE3N8uNjhKPRHfANdwGvCZghWXyLPdqdSbEW2XFwBiX` (feed `72b0…4419`, expo −10, age 5–30 s, conf 7–9 bps, Full) | **Exact ✓** (Q10 = 27 100)                    |
| SOL (wSOL) | `So11111111111111111111111111111111111111112`  | Token      | 9   | —                                                                                                                                                                 | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` (feed `ef0d…b56d`, expo −8, age 5–30 s, conf 1–2 bps, Full)  | **Exact ✓**                                   |
| TSLAx      | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB`  | Token-2022 | 8   | metadataPointer, permanentDelegate, defaultAccountState, scaledUiAmount (1.0), pausable (false), confidentialTransferMint, transferHook (**null**), tokenMetadata | `E8WFH8brgP58arcuW2wwsPHiomYrSvrgWTsRLZLAEZUQ` (age 48 h, conf 5 bps)                                       | Exact ✗ (closed) · LastKnown ✓ ($365.275)     |
| SPYx       | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W`  | Token-2022 | 8   | same set; scaledUiAmount mult **1.005714…** (new multiplier effective)                                                                                            | `9owhtgrdLiUMAH9JKxYFt5pUY4Luy4EzzLhdcWPVuDyy` (age 18 d)                                                   | ✗ stale on-chain — needs Hermes-posted update |
| NVDAx      | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`  | Token-2022 | 8   | same; mult 1.001701…                                                                                                                                              | `2w1Tg1XTZbUib7srfRoStJ4v5JXVsK7roQEGMsMaGZFC` (age 18 d)                                                   | ✗ needs Hermes                                |
| AAPLx      | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`  | Token-2022 | 8   | same; mult 1.003269…                                                                                                                                              | `DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy` (age 30 d)                                                   | ✗ needs Hermes                                |
| MSTRx      | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ`  | Token-2022 | 8   | same; mult 1.0                                                                                                                                                    | `HJGvGyWrAXdZPG4Q7LNkkKja72FDkJW7ixuyg3u6vZyP` (age 30 d, conf 28 bps)                                      | ✗ needs Hermes                                |

All seven mints pass the program's extension policy (no transfer fee, hook program null, not paused). The oracle rows were produced by running the production `validatePriceUpdate` policy (the code the Rust engine transcribes, vector-parity tested) on the live `PriceUpdateV2` accounts, including the on-chain ScaledUi multiplier.

**Consequence:** on mainnet only crypto feeds are kept fresh in sponsored accounts. Equity Arenas need the crank to post Hermes updates (`/v2/updates/price/{t}` → receiver `post_update`), which needs a **Pyth Hermes API key** (Pyth Terminal) and the receiver post flow in the crank — not yet wired.

### Jupiter (USDC → BONK, 10 USDC, keyless lite-api)

Route HumidiFi → Whirlpool, 45 accounts, 2 ALTs, 1 setup ix, 2 compute-budget ixs, impact 0 %.
Versioned transaction sizes (measured): **swap only 1 034 B; swap + back > 1 232 B; swap + open_position + back > 1 232 B; open_position + back alone 870 B (legacy).**
→ The atomic swap+Back does **not** fit. Mainnet flow is two transactions, shown as two steps (Jupiter buy → Tribe Back), never described as atomic. A Tribe address-lookup table could make some routes fit later; not needed for the canary.

Re-tested 2026-09-16 09:27 UTC+8 with the canary wallet as owner (unsigned): 10 USDC → 395 900.00000 BONK (min-out 393 920.5, 50 bps, impact 0 %), route Deriverse → Scorch, 721 B v0 transaction, priority fee 53 936 lamports; implied $2.5259e-6 vs Pyth $2.5248e-6 (4 bps apart).

### Rent / cost (mainnet `getMinimumBalanceForRentExemption`, re-read 2026-09-16 09:26 UTC+8 for the Q10 binary)

Exact account sizes come from the IDL account coder (`mainnet-setup` dry run); ATAs are legacy SPL token accounts (USDC, BONK and wSOL are all legacy mints).

| Account                                                             | Bytes   | SOL          | Paid by       |
| ------------------------------------------------------------------- | ------- | ------------ | ------------- |
| Program account                                                     | 36      | 0.00083312   | authority     |
| ProgramData, `--max-len 800000`                                     | 800 045 | 4.06487884   | authority     |
| _(ProgramData at exact size 639 536 B — not used)_                  | 639 581 | _3.24972172_ | —             |
| ProtocolConfig                                                      | 305     | 0.00219964   | authority     |
| Upset-reserve ATA (config PDA, USDC)                                | 165     | 0.00148844   | authority     |
| Treasury ATA (authority, USDC)                                      | 165     | 0.00148844   | authority     |
| AssetEntry × 2 (SOL, BONK)                                          | 159 × 2 | 0.00291592   | authority     |
| Canary Arena                                                        | 896     | 0.00520192   | authority     |
| Reward vault ATA (Arena PDA, USDC)                                  | 165     | 0.00148844   | authority     |
| Sponsor record                                                      | 82      | 0.0010668    | canary wallet |
| Position × 2                                                        | 192 × 2 | 0.0032512    | canary wallet |
| Position vault ATA × 2 (wSOL, BONK)                                 | 165 × 2 | 0.00297688   | canary wallet |
| Backer's own wSOL ATA (wrap step)                                   | 165     | 0.00148844   | canary wallet |
| **Deploy (program + ProgramData)**                                  |         | **4.0657**   | authority     |
| **Bootstrap (config, reserve, treasury, two assets)**               |         | **0.0081**   | authority     |
| **Canary Arena + reward vault**                                     |         | **0.0067**   | authority     |
| **Authority rent total**                                            |         | **4.0805**   |               |
| **Canary wallet rent total (sponsor, positions, vaults, wSOL ATA)** |         | **0.0088**   |               |
| Temporary upgrade buffer (refunded on success)                      | 639 581 | 3.2497       | authority     |

Fees: ≈ 640 buffer-write transactions at 5 000 lamports plus a 20 000 µlamport/CU priority fee ≈ 0.01 SOL; bootstrap + canary ≈ 20 transactions ≈ 0.002 SOL; Jupiter swap priority fee ≈ 0.00005 SOL.

Recommended funding (the earlier estimate, now backed by exact figures):

| Wallet                                  | SOL      | USDC   | Why                                                                                                                                  |
| --------------------------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Upgrade / protocol authority `DWD51Yp…` | **8**    | —      | 4.08 rent + fees, plus a 3.25 SOL reserve so one upgrade can be performed without waiting for a buffer refund                        |
| Crank `Df99dap…`                        | **0.1**  | —      | fees only (snapshot_start, settle, cancel_expired, sweep)                                                                            |
| Canary wallet `FPmuksz…`                | **0.25** | **25** | 0.0088 rent + ≈ 0.1 SOL wrapped for the SOL-side Back + fees; 5 USDC sponsor + ≈ 10 USDC BONK buy + 0.50 % fee on each Back + margin |

## 3. Identities (public keys only; private keys stay in `~/tribe-keys/`, never in the repo, Vercel, Neon or CI)

| Role                                   | Address                                        | Notes                                                                                                                                                                                                                          |
| -------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Program                                | `shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4`  | **Reuse the existing program keypair**: same address on devnet and mainnet, deterministic, already in docs/registry/frontend. The keypair only authorises the initial deploy; the upgrade authority controls everything after. |
| Upgrade authority / protocol authority | `DWD51YpXjfWLxEKQTBkLZY9Gtx6gWnfXz6cz4wqbm8HZ` | new mainnet key; fund with 8 SOL; treasury = its USDC ATA for the hackathon                                                                                                                                                    |
| Crank                                  | `Df99dapLJ7D18aacKFdLwLj2DBEn1xSm7CHtTSC73TH9` | new low-value key; only snapshot_start / settle / cancel_expired / sweep                                                                                                                                                       |
| Canary wallet                          | `FPmukszezHUpfqu3QfExiEEq8qunWHczYpsWF7FTgr2x` | plays the judge path with tiny value (0.25 SOL + 25 USDC)                                                                                                                                                                      |
| USDC                                   | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |                                                                                                                                                                                                                                |

## 4. First canary

**Recommended pair: SOL vs BONK** (both legacy SPL, both sponsored Pyth feeds fresh every few seconds, deepest liquidity, 24/7 so a 2 h Arena can settle at any hour, no Token-2022, no Hermes dependency) — **after M1 is resolved** (Q10), or **SOL vs TSLAx with a Hermes key** if BONK must wait. BONK vs TSLAx becomes the showcase Arena once both the Q10 change and Hermes posting are in place.

Backing SOL requires wrapped SOL in a token account; the client will add wrap (create wSOL ATA + transfer + syncNative) to the Back transaction for the SOL side.

Canary parameters: start +5 min, duration 2 h (limits allow ≥ 1 h), sponsor 5 USDC, backs of ≈ 5–10 USDC per side from the canary wallet, crank on a 30 s loop from a hosted worker (settlement window ±120 s of end).

## 5. Config / environment changes required

Frontend (done in code, config-driven): `NEXT_PUBLIC_TRIBE_PROTOCOL_CLUSTER=mainnet-beta`, `NEXT_PUBLIC_TRIBE_PROTOCOL_RPC_URL=<paid RPC>`, `NEXT_PUBLIC_MARKET_CLUSTER=mainnet-beta`, program id unchanged; the status pill becomes `LIVE MARKETS · SOLANA MAINNET`, on-chain badges read `MAINNET`; devnet faucet and stand-in copy disable themselves. Crank: `CRANK_RPC_URL`, `CRANK_KEYPAIR` (secret), `TRIBE_PROGRAM_ID`. Bootstrap: `packages/program-client/tests/mainnet-setup.test.ts` (dry run by default; `MAINNET_SETUP_WRITE=1` + `MAINNET_AUTHORITY_KEYPAIR` to execute; `MAINNET_ASSETS`, `MAINNET_CANARY`).

## 6. Mainnet execution plan (prepared 2026-09-16, NOT executed)

Release: the commit at `origin/main` HEAD (program sources unchanged since `04d16d5`); `target/deploy/tribe_arena.so` **639 536 B**, sha256 `2588ad7e8d106c53a5ec1a4ae6a9c879724737d5e77001d7404c139afef1ef5e`, produced from `cargo clean` twice with identical output; committed IDL sha256 `a5d8598d8d42eb2b11704404eb1c7ac9f36d80f9bc33dbf5975ca90db31918bc`. Every command below runs in WSL from `~/tribe` at that commit with `MAINNET_RPC` set to a paid mainnet-beta endpoint. Nothing here runs until explicitly authorised.

### 6.1 Deploy (the upgrade authority pays)

```bash
MAINNET_RPC=<paid rpc> scripts/deploy-mainnet.sh                     # prints the plan and stops
MAINNET_RPC=<paid rpc> CONFIRM_MAINNET=yes scripts/deploy-mainnet.sh  # deploys, then show + dump + sha256 compare
```

Underlying command (max-len 800000, upgrade authority = payer):

```bash
solana program deploy target/deploy/tribe_arena.so \
  --program-id ~/tribe-keys/tribe_arena-keypair.json \
  --buffer ~/tribe-keys/mainnet-buffer.json \
  --keypair ~/tribe-keys/mainnet-upgrade-authority.json \
  --upgrade-authority ~/tribe-keys/mainnet-upgrade-authority.json \
  --max-len 800000 --url $MAINNET_RPC --with-compute-unit-price 20000 --max-sign-attempts 100 --use-rpc
```

Who pays: `--keypair` (the upgrade authority `DWD51Yp…`) funds the temporary buffer (3.2497 SOL, moved into ProgramData on finalisation), tops ProgramData up to its 4.0649 SOL rent, pays the 0.0008 SOL program account and every fee. The program keypair signs only the creation of the program account and holds no funds.

Verification (steps 2–4): `solana program show shzfc…` → executable, owner `BPFLoaderUpgradeab1e…`, authority `DWD51Yp…`, data length 800 000; `solana program dump` → first 639 536 bytes sha256 == release hash. **Stop on mismatch.**

### 6.2 Bootstrap (steps 5–11, authority signs; idempotent)

```bash
MAINNET_SETUP=1 MAINNET_RPC=<paid rpc> pnpm --filter @tribe/program-client exec vitest run --config vitest.program.config.ts tests/mainnet-setup.test.ts
# dry run: USDC, mints, Pyth freshness/confidence, exact rent, program/config state — nothing signed
MAINNET_SETUP=1 MAINNET_SETUP_WRITE=1 MAINNET_ASSETS=SOL,BONK MAINNET_RPC=<paid rpc> \
  MAINNET_AUTHORITY_KEYPAIR=$HOME/tribe-keys/mainnet-upgrade-authority.json \
  pnpm --filter @tribe/program-client exec vitest run --config vitest.program.config.ts tests/mainnet-setup.test.ts
```

Order inside the armed run: `init_config` (USDC `EPjFWdd5…`, treasury = authority USDC ATA created idempotently, upset reserve = config-PDA USDC ATA, fee 50 bps split 40/40/20, limits and default params as reviewed in §1) → **`set_paused(true)` immediately** → `set_asset` SOL (`So111…112`, class Crypto, tolerance 120 s, conf ≤ 100 bps, staleness 0) → `set_asset` BONK (`DezXAZ…B263`, same policy) → read back the config and both AssetEntry accounts and assert feed ids `ef0d8b6f…` (SOL) and `72b02121…` (BONK). The protocol ends this run **paused**: `create_arena` and `back` are gated, everything else works. The crank is not started yet (nothing to crank).

### 6.3 Canary Arena (step 12 onwards)

Pre-flight in the same session: re-run the dry run and require SOL and BONK feed age < 120 s, conf ≤ 100 bps, `Full`; compare the Pyth price with Jupiter Price v3 (within 1 %).

```bash
MAINNET_SETUP=1 MAINNET_SETUP_WRITE=1 MAINNET_ASSETS=SOL,BONK MAINNET_CANARY=SOL,BONK \
  MAINNET_CANARY_START_IN_SECS=300 MAINNET_CANARY_DURATION_SECS=7200 MAINNET_RPC=<paid rpc> \
  MAINNET_AUTHORITY_KEYPAIR=$HOME/tribe-keys/mainnet-upgrade-authority.json \
  pnpm --filter @tribe/program-client exec vitest run --config vitest.program.config.ts tests/mainnet-setup.test.ts
```

This run finds the config and assets already present, `set_paused(false)`, then `create_arena` (SOL vs BONK, start +5 min, 2 h, sponsorOpen, firstParty, creator = authority). Then start the crank (`CRANK_RPC_URL`, `CRANK_KEYPAIR=~/tribe-keys/mainnet-crank.json`, 30 s loop) so `snapshot_start` lands inside the 120 s window.

Canary safety gate before the first Back — all read from chain and compared with the values above: binary hash, config authority / treasury / USDC / `paused = false`, asset mints and feed ids, Arena parameters (start, end, tie 1 bps, fee 50 bps), reward vault holding the 5 USDC sponsor, feeds fresh. **Any difference → stop; no workaround with real funds.**

Lifecycle, every signature recorded in DEPLOYMENTS.md: sponsor 5 USDC (canary wallet) → crank `snapshot_start` (record both Q10 prices) → **Back SOL** through the wSOL path (record SOL before, lamports wrapped, units backed, Position Vault balance) → **Back BONK** as two transactions (tx1 Jupiter USDC → BONK: record quote, min-out, received delta; tx2 `open_position + back` with exactly that delta) → inspect both Position Vault ATAs → partial Exit on one side (forfeit copy shown; record vault and wallet deltas) → hold → end → crank `settle` (record end prices, perf bps, winner, W_total, pool) → winner `claim` → loser `claim` rejected (record the error) → full `exit` withdrawals → SOL side unwrap (record final SOL / wSOL). Network fees are recorded separately, never as PnL.

### 6.4 After the canary

Hermes posting (`HERMES_POSTING.md`) → register TSLAx → BONK vs TSLAx showcase. Not before.

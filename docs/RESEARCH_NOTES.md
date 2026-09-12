# Research Notes (verified 2026-09-12)

Facts gathered during Phase 0 by calling the live APIs and registries. These
are inputs to ARCHITECTURE.md; re-verify anything marked *(re-check)* before
relying on it in code.

## 1. xStocks public API

- Base: `https://api.xstocks.fi/api/v2/public/*`, **no auth**, `pageSize ≤ 100`.
- `GET /assets?network=Solana&page=N` → 832 Solana assets (9 pages).
  Fields: `symbol`, `name`, `isin`, `underlying{symbol,isin,type,listingCountry}`,
  `logo`, `isTradingHalted`, `trading{currency, tradingHoursMode
  ("TwentyFourFive"), isTradingHalted, currentPeriod (market|extended|overnight|closed),
  openNow, nextChangeAt, exchange{mic,abbreviation,name,timezone}, limitsPerPeriod}`,
  `deployments[{address, network, supportsAtomicSwaps, stablecoins[]}]`.
- `GET /assets/{symbol}` — single asset (same shape).
- `GET /assets/{symbol}/price-data` → `{ quote: number | null }` — **null when the
  market is closed** (observed Saturday). Not usable as sole reference.
- `GET /assets/{symbol}/multiplier?network=Solana` →
  `{currentMultiplier, newMultiplier, activationDateTime, reason: FeeAccrual|Dividend|Split|ReverseSplit|Administrative|null}`.
- `GET /system/status/{symbol}` → `{symbol, isMarketTradingHalted, isAtomicTradingHalted}`.
- `GET /oracles?network=Solana` → 65 entries; `managedBy` ∈ {Pyth, Chainlink};
  Pyth entries carry `metadata.hermesId` (may be null), `pythLazerId`,
  `verifierContract` (`pytd2yyk641x7ak7mkaasSJVXh6YYZnC7wTmtgAyxPt`), Chainlink
  entries carry `feedId`, `verifierContract` (`Gt9S41PtjR58CbG9JhJ3J6vxesqrNAswbWYbLNTMZA3c`).
- `GET /corporate-actions/upcoming` and `/history` — paginated, filter by `symbol`.
- `GET /proof-of-reserves`, `/proof-of-reserves/{symbol}`.
- Docs: multiplier activates at **00:30 UTC the day after ex-date**; venues are
  advised to pause around activation. Solana implementation = Token-2022
  **Scaled UI Amount**: raw balance constant, displayed = raw × multiplier;
  **raw amounts must be used in transactions**.

### Seed-asset mints (Solana)

| Symbol | Name | Solana mint | Atomic swaps |
| --- | --- | --- | --- |
| TSLAx | Tesla xStock | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | yes |
| SPYx | SP500 xStock | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | yes |
| MSTRx | MicroStrategy xStock | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` | yes |
| DISx | The Walt Disney xStock | `Xsg93jDV656ULQ5u9yT2x5DS9b4xGD8aDCtfESSW6Bb` | yes |
| NVDAx | NVIDIA xStock | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | yes |
| AAPLx | Apple xStock | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | yes |
| GMEx | Gamestop xStock | `Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc` | yes |
| GLDx | Gold xStock | `Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re` | yes |
| QQQx | Nasdaq xStock | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | yes |
| COINx | Coinbase xStock | `Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu` | yes |
| HOODx | Robinhood xStock | `XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg` | yes |
| CRCLx | Circle xStock | `XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1` | yes |
| METAx | Meta xStock | `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` | yes |
| GOOGLx | Alphabet xStock | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | yes |
| AMZNx | Amazon.com xStock | `Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg` | yes |
| MSFTx | Microsoft xStock | `XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX` | yes |

### Issuer-published oracle ids (secondary references)

| Symbol | Pyth xStock-specific hermesId | Pyth Lazer id | Chainlink feedId |
| --- | --- | --- | --- |
| TSLAx | `47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362` | 1847 | `0x000a80c655069b61d168b887d5e7f4231fe288c6ccb84b1854c9ccead20f3398` |
| SPYx | `2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14` | 1843 | `0x000ac6ba1b453a15c1fe9dcd82265ca47bcd04e7b3667de1623617c45cef2a77` |
| MSTRx | `53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28` | 1827 | `0x000a7b26938f7df83a0bd00f76b0f644a6ef4f28b5cbb9afb800fbcdc8536255` |
| DISx | — | — | — |
| NVDAx | `4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f` | 1833 | `0x000a37a55df2ef907d8fa06af6632bc16da58a62b68be2e1994efaa037a0918a` |
| AAPLx | `978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675` | 1792 | `0x000a7a12270b5a30236bf410679df0c6bb1bba2b40e5d86847748ff1c8f8452b` |
| GMEx | — | 3387 | — |
| GLDx | `e7d1138d0083368634087268c64b7bea0b4101a6365f83915cba9e76a8364b96` | 3640 | — |
| QQQx | `178a6f73a5aede9d0d682e86b0047c9f333ed0efe5c6537ca937565219c4054d` | 1837 | `0x000a1db22e3e1aa657d910dc90e1f0dbe693d345b7b0b04fd9efc8eb17aef267` |

Coverage is uneven (DISx none, GMEx Lazer-only) — this is why settlement uses
the canonical Pyth `Equity.US.*` feeds × on-chain multiplier instead.

## 2. TSLAx mint (mainnet, `getAccountInfo` jsonParsed)

- Owner: **Token-2022** (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`), decimals **8**.
- Mint authority `7pt9tk…`, freeze authority `JDq14B…`.
- Extensions: `metadataPointer`, **`permanentDelegate`** (`5aMNNL…`),
  `defaultAccountState = initialized`, **`scaledUiAmountConfig`**
  (`multiplier "1"`, `newMultiplier "1"`, `newMultiplierEffectiveTimestamp 0`),
  **`pausableConfig`** (`paused false`), `confidentialTransferMint`
  (`autoApproveNewAccounts false`), **`transferHook`** (`programId null`),
  `tokenMetadata` (uri `https://xstocks-metadata.backed.fi/tokens/Solana/TSLAx/metadata.json`).
- No `transferFeeConfig`.
- BONK (`DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`): legacy SPL Token, decimals 5,
  no authorities.

## 3. Pyth

- **Hermes requires an API key since 2026-08-26.** Public
  `hermes.pyth.network` returns `401 unauthorized`. New base:
  `https://pyth.dourolabs.app/hermes`, header `Authorization: Bearer $PYTH_API_KEY`,
  keys from Pyth Terminal (`https://pythdata.app/signup`), free trial then paid.
  Routes/response shapes unchanged (`/v2/updates/price/latest`,
  `/v2/updates/price/{publish_time}`, `/v2/price_feeds`).
- `GET /v2/price_feeds?asset_type=equity` still works unauthenticated (1 249
  feeds); `asset_type=crypto` (422 feeds). Feed metadata includes
  `market_hours{is_open,next_open,next_close}` and
  `attributes.schedule` (`America/New_York;0930-1600,…`) for equities.
- Canonical feed ids (Q: `/USD`):

  | Feed | id |
  | --- | --- |
  | Crypto.BONK/USD | `72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419` |
  | Crypto.SOL/USD | `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |
  | Crypto.BTC/USD | `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` |
  | Crypto.PENGU/USD | `bed3097008b9b5e3c93bec20be79cb43986b85a996475589351a21e67bae9b61` |
  | Crypto.WIF/USD | `4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc` |
  | Crypto.ETH/USD | `ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace` |
  | Crypto.JUP/USD | `0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996` |
  | Crypto.USDC/USD | `eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` |
  | Equity.US.TSLA/USD | `16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` |
  | Equity.US.SPY/USD | `19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5` |
  | Equity.US.MSTR/USD | `e1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09` |
  | Equity.US.DIS/USD | `703e36203020ae6761e6298975764e266fb869210db9b35dd4e4225fa68217d0` |
  | Equity.US.NVDA/USD | `b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593` |
  | Equity.US.AAPL/USD | `49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688` |
  | Equity.US.GME/USD | `6f9cd89ef1b7fd39f667101a91ad578b6c6ace4579d5f7f285a4b06aa4504be6` |
  | Equity.US.GLD/USD | `e190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca` |
  | Equity.US.QQQ/USD | `9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d` |
  | Equity.US.COIN/USD | `fee33f2a978bf32dd6b662b65ba8083c6773b494f8401194ec1870c640860245` |
  | Equity.US.HOOD/USD | `306736a4035846ba15a3496eed57225b64cc19230a50d14f3ed20fd7219b7849` |
  | Equity.US.CRCL/USD | `92b8527aabe59ea2b12230f7b532769b133ffb118dfbd48ff676f14b273f1365` |

- Solana receiver program id `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` *(re-check)*;
  Rust `pyth-solana-receiver-sdk` 2.0.0; TS `@pythnetwork/pyth-solana-receiver` 0.16.0,
  `@pythnetwork/hermes-client` 3.1.0.

## 4. Jupiter

- Base `https://api.jup.ag`, header `x-api-key` (keys at developers.jup.ag).
  `GET /swap/v2/order` **without** `taker` returned a quote unauthenticated
  (USDC→TSLAx 100 USDC → 0.27337718 TSLAx via Orca Whirlpool, `priceImpactPct
  0.0007`); `lite-api.jup.ag/swap/v2/order` returned 404 *(re-check whether
  keyless access is stable; assume a key is required in production)*.
- `swap/v1/quote` is deprecated; use `swap/v2/order` (quote when `taker`
  omitted), `swap/v2/execute`, `swap/v2/build` (Metis-only, raw instructions
  for composition).
- `GET /price/v3?ids=` (≤ 50 mints): `usdPrice`, `liquidity`, `blockId`,
  `decimals`, `priceChange24h`; xStocks include
  `stockData{id:"xstocks", price, mcap, updatedAt}`. Omitted mints = unreliable
  pricing (fail closed). Observed: BONK liquidity ≈ $1.04 M, SOL ≈ $833 M,
  TSLAx ≈ $1.28 M.
- `GET /tokens/v2/search?query=<mint>`: `isVerified`, `organicScore`,
  `organicScoreLabel`, `audit{isSus?, mintAuthorityDisabled, freezeAuthorityDisabled,
  topHoldersPercentage, …}`, `tokenProgram`, `holderCount`, `stats5m/1h/6h/24h{
  buyVolume, sellVolume, buyOrganicVolume, sellOrganicVolume, numTraders, …}`.
  TSLAx: `tokenProgram` Token-2022, 36 060 holders; 1 h organic buy volume
  ≈ $1.9 k of $8.4 k total — the organic ratio is a usable wash signal.
- Rate limit: 50 req / 10 s base for Swap; others per portal.
- Agent skill: `github.com/jup-ag/agent-skills` → `skills/integrating-jupiter/SKILL.md`.

## 5. Wash-trading reference (mkzung/solana-xstocks-wash-analysis)

- Wallet-level detector: "balanced heavy round-tripper" = ≥ 5 buys and ≥ 5
  sells in the same pool landing within 10% of flat. Five of nine liquid
  xStock pools flagged (score 0.36–0.80); organic controls (WIF, JUP) score 0.
- It is **pool-specific**: TSLAx flagged on Orca, not Raydium; QQQx in one
  Raydium pool, not another.
- Data sources are free: Dexscreener, GeckoTerminal, public RPC, Helius
  free tier. Method reusable for Tribe's market-quality job.

## 6. Toolchain / package versions (npm `latest`, 2026-09-12)

next 16.3.5 · react 19.3.0 · typescript 7.0.2 (latest) / 5.9.3 (pinned) ·
tailwindcss 4.3.3 · @tailwindcss/postcss 4.3.3 · @solana/web3.js 1.99.0 ·
@solana/kit 8.3.0 · @solana/wallet-adapter-react 0.15.40 (peer web3.js ^1.99) ·
@solana/wallet-adapter-react-ui 0.9.40 · @solana/wallet-adapter-wallets 0.19.39 ·
@wallet-ui/react 4.3.0 (peer kit ^6||^7 — lags kit 8) · @solana/spl-token 0.4.15 ·
@anchor-lang/core 1.2.0 (replaces @coral-xyz/anchor 0.32.1) ·
@pythnetwork/hermes-client 3.1.0 · @pythnetwork/pyth-solana-receiver 0.16.0 ·
@jup-ag/api 6.0.48 · @meteora-ag/dlmm 1.9.14 · vitest 5.0.0 · eslint 10.10.0 ·
prettier 3.9.6 · zod 4.6.2 · radix-ui 1.6.7 · motion 13.2.0 ·
@tanstack/react-query 5.102.8 · zustand 5.0.15 · pnpm 12.4.1.

Rust: anchor-lang / anchor-spl 1.2.0 (2026-09-04; adds pausable extension
support), spl-token-2022 11.0.0, pyth-solana-receiver-sdk 2.0.0, Agave v4.2.2.

Next.js 16.3 supports TypeScript 7 via `experimental.useTypeScriptCli`; Tribe
pins TS 5.9.3 until typescript-eslint and Vitest support is confirmed.

## 7. Local environment

- Windows 11, Node 22.11, npm 10.9, corepack 0.29, git 2.41, Docker 29.6.
- No Solana CLI / Anchor / Rust on Windows. WSL Ubuntu 22.04 has cargo
  (rustc 1.73 — must upgrade) — Anchor builds will run there.
- GitHub repo `0xnald/tribe` exists and is empty; HTTPS credential manager is
  configured (push will prompt for auth on first use).

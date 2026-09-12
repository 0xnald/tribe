# Tribe — Product Definition

> **Status:** Source of truth. Changes to terminology, the financial model, or
> the core loop require explicit approval.
>
> **Tagline:** *Don't bet on what you believe in. Own it.*

---

## 1. What Tribe is

Tribe is a **competitive ownership layer for markets**.

Users enter live **Arenas** where two real assets compete on relative price
performance over a defined time window — Solana meme coins against tokenized
Wall Street stocks, index ETFs against SOL, gold against Bitcoin.

When a user **Backs** a side, their capital is routed into the *actual asset*.
They own it. The Arena decides who earns additional **Arena Rewards** and
reputation. It never decides who keeps their money.

### 1.1 What Tribe is not

**Tribe is not a binary prediction market.** Users purchase or commit real
spot assets. Arena outcomes govern *additional rewards* rather than
transferring losing users' principal to winners.

Tribe is also not:

- a trading terminal or brokerage dashboard,
- a robo-advisor or portfolio tracker,
- an AI trading bot,
- a DEX frontend with a leaderboard bolted on,
- a leveraged or synthetic product. No position in Tribe can lose more than
  the market value of the underlying asset the user owns.

## 2. The core loop

1. **Discover a narrative.** "Meme coins vs. Wall Street", "Solana vs. the S&P",
   "Gold vs. Bitcoin". Arenas are the unit of narrative.
2. **Choose a side.** BONK or TSLAx. SOL or SPYx.
3. **Back it with real ownership.** USDC is swapped into the asset via Jupiter,
   or the user commits an asset balance they already hold.
4. **Hold through the Arena.** Holding longer matters. Reward weight accrues
   with time.
5. **Return to watch the matchup.** Live performance, lead changes, backing
   split, countdown.
6. **Share the Arena.** Every Arena renders a social card and deep link.
7. **Earn when conviction is correct.** The winning side shares the Arena
   Reward Pool, weighted by capital × time held × underdog multiplier.
8. **Victory Roll.** Roll rewards into more of the winning asset, or into the
   next Arena.
9. **Create the next Arena.** Anyone can create an Arena around a trending
   narrative and earn a share of its fees.

This must feel like a **consumer social-finance product**, not a terminal.

## 3. Terminology (fixed)

| Term | Meaning |
| --- | --- |
| **Tribe** | The product. |
| **Arena** | The core primitive: two assets, one time window, one winner. |
| **Back** | The user action of committing capital to a side of an Arena. |
| **Arena Position** | A user's committed holding on one side of one Arena. |
| **Backing** | The capital metric (USD value committed to a side / an Arena). |
| **Arena Winner** | The side whose asset has the greater percentage return at settlement. |
| **Arena Rewards** | Additional USDC rewards distributed to winning-side positions from the Arena Reward Pool. |
| **Victory Roll** | Compounding rewards into more of the winning asset and/or the next compatible Arena. |
| **Conviction Score** | The user's reputation metric. |
| **Arena Creator** | The wallet that created an Arena; earns a configured share of its fees. |

Do not rename these without explicit approval. UI copy, code identifiers,
program account names, and documentation must use these terms consistently.

## 4. The financial model (summary)

The full model with equations is in [ECONOMICS.md](./ECONOMICS.md). The
invariants below are product commitments:

1. **Real spot ownership.** Backing a side means owning the asset. The user's
   economic exposure is the asset's market price, nothing else.
2. **Principal is never transferred between sides.** Losing an Arena costs a
   user nothing beyond the asset's own market movement.
3. **Arena Rewards come from fees and sponsors**, not from losers: Arena fees,
   sponsored pools, protocol-funded promotional pools, creator-funded pools.
4. **Rewards are conviction-weighted**: capital × holding duration × underdog
   multiplier, computed deterministically on-chain from integer accumulators.
5. **Nobody is locked.** Users can exit an Arena Position before settlement.
   For the MVP a full early exit forfeits future Arena Rewards for that
   position; the underlying asset is always withdrawable.
6. **Underdog multipliers never touch principal** and are capped and smoothed
   against manipulation.
7. **Existing holders can enter** with assets they already own, without buying
   again, committing only the amount they choose.

Worked example — **BONK vs TSLAx**, user backs BONK with 100 USDC:

| Scenario | BONK move | TSLAx move | Arena result | Underlying value | Arena Rewards |
| --- | --- | --- | --- | --- | --- |
| A | +15% | +2% | BONK wins | ≈ $115 | share of pool |
| B | +5% | +9% | BONK loses | ≈ $105 | none |
| C | −10% | −12% | BONK wins | ≈ $90 | share of pool |
| D | −10% | +1% | BONK loses | ≈ $90 | none |

In every row the user still owns their BONK when the Arena ends. They can
keep it, sell it, or roll it into another Arena.

## 5. Who it is for

**Primary user — the narrative-driven Solana native.** Holds memes and SOL,
has opinions about Tesla and NVIDIA, is bored by brokerage apps, and lives on
Crypto Twitter. Wants to *do something* with a conviction without a 20x perp.

**Secondary user — the tokenized-stock curious.** Has heard xStocks exist on
Solana but has no reason to hold them. An Arena — "back NVDAx against SOL for
24 hours" — is the first fun reason to own a tokenized stock.

**Tertiary — creators and sponsors.** Communities, token teams, and brands who
want to put a narrative on a scoreboard and fund a reward pool around it.

## 6. Why this belongs on Solana

- **Tokenized stocks already trade here.** xStocks (832 Solana deployments at
  time of writing) are Token-2022 assets with on-chain rebasing multipliers,
  atomic-swap support, and Pyth/Chainlink oracle mappings.
- **Memes vs. stocks is only possible on one chain.** BONK, WIF, PENGU and
  TSLAx, NVDAx, SPYx share one wallet, one settlement layer, one liquidity
  router (Jupiter). The core Arena "BONK vs TSLAx" cannot exist anywhere else.
- **Cheap, fast state updates** make time-weighted on-chain accumulators,
  frequent backing, and one-signature "swap + back" transactions practical.
- **Pyth pull oracles on Solana** give verifiable settlement prices for both
  crypto and US equities in the same program.

## 7. Product surfaces (MVP)

| Surface | Purpose |
| --- | --- |
| **Home** | Hero Arena, Live Arenas, Trending, Ending Soon, Sponsored, Leaderboard teaser, How Tribe Works. |
| **Arena page** | The visual star. Understandable in five seconds. Entry flow lives here. |
| **Back flow** | Choose side → entry method (USDC or existing holdings) → amount → preview (route, slippage, fee, position, multiplier, eligibility) → sign → success → live position. |
| **My Arenas** | Live positions, asset PnL, Arena relative performance, reward weight, projected share (labelled estimate), early exit, completed Arenas, claims, Victory Roll. |
| **Create Arena** | Asset A, asset B, duration, optional reward funding, title, description. |
| **Creator page** | Arenas created, backing, fees earned, participants, ranking. |
| **Leaderboard** | Conviction Score, win rate (min participation), streaks, biggest upset, top creators, most-backed creators. |
| **Share card** | OG image + deep link for every Arena. |

Detailed UI specifications live in [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

## 8. Seed Arenas

The featured hero Arena is **BONK vs TSLAx** — Solana meme culture vs. Wall
Street in three words.

| Arena | Narrative |
| --- | --- |
| BONK vs TSLAx | Memes vs. Wall Street |
| SOL vs SPYx | Solana vs. the S&P 500 |
| BTC vs MSTRx | The asset vs. the leveraged proxy |
| PENGU vs DISx | Internet culture vs. legacy media |
| NVDAx vs AAPLx | AI vs. the incumbent |
| WIF vs GMEx | Meme coin vs. meme stock |
| GLDx vs BTC | Old money vs. digital gold |

Seed Arenas are clearly labelled as **demo** or **live** according to the
demo/real-mode rules in [ARCHITECTURE.md](./ARCHITECTURE.md#demo-mode-vs-real-mode).

## 9. Demo mode vs. real mode (product commitment)

Judges must be able to experience Tribe even if an external API is down, but
Tribe never presents simulated behaviour as real. Every Arena and every
position carries a visible provenance badge:

- **Live** — on-chain Arena, real prices, real transactions.
- **Demo** — seeded Arena with simulated prices; no wallet transactions.
- **Fixture** — historical or test data used for tests and screenshots.

## 10. Non-goals for the hackathon

- Leverage, shorting, options, or synthetic exposure of any kind.
- Fiat on-ramp.
- Cross-chain bridging.
- Multi-asset (3+) Arenas.
- Mobile native apps (the web app is mobile-first and responsive).
- Governance tokens.

## 11. Success criteria (Stocklana judging)

> *Could this be a real app that people will actually use?*

- A real user and problem: narrative-driven holders who want a reason to own
  tokenized stocks and memes side by side.
- A working end-to-end demo: back a side with real USDC through Jupiter into a
  real asset, watch the Arena live, settle on-chain, claim, Victory Roll.
- A reason it belongs on Solana: xStocks + memes + Jupiter + Pyth in one
  program, one wallet, one transaction.
- Quality of execution: the Arena page should make someone want to pick a
  side within five seconds.

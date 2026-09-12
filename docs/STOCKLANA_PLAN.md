# Tribe — Stocklana Plan

> **Status:** Source of truth for scope, phases, and the submission.
> Hackathon: Solana Foundation **Stocklana**. Submissions close
> **Friday 18 September 2026, 4:00 pm ET**. Judging through 2 October.
> Judging question: *could this be a real app that people will actually use?*
> Track wedge: **Consumer** (social trading / mobile-first investing) built on
> tokenized stocks, with Trading (stock-to-stablecoin swaps via Jupiter) as
> the mechanism.

---

## 1. MVP scope (what ships by 18 Sept)

### Must ship

| Area | Deliverable |
| --- | --- |
| Program | `tribe_arena` (Anchor 1.2): config, asset registry, create_arena, fund_reward_pool, snapshot_start, back, exit, settle, claim, cancel_arena, cancel_expired, refund_sponsor. Pyth `PriceUpdateV2` verification. Token-2022 + legacy SPL vaults. Rust + TS tests for every threat-matrix row marked "program". |
| Core | `packages/core`: fixed-point math, accrual, underdog multiplier, settlement, distribution, fee policy, state machine, config schemas, market-quality gates, shared vectors. 100% of ECONOMICS covered by tests. |
| Web — Home | Nav, hero (tagline + featured BONK vs TSLAx), Live Arenas, Trending, Ending Soon, Sponsored, Leaderboard teaser, How Tribe Works. |
| Web — Arena page | Everything in PRODUCT §7: prices, performance, bar, countdown, backing, participants, pool, underdog tag, status, rules drawer, price-source info, market-quality indicators, activity, creator, share. |
| Web — Back flow | USDC (Jupiter build + back, one signature) and existing holdings; full preview; success; live position. |
| Web — My Arenas | Positions, PnL, weight, estimate, exit, completed, claim, Victory Roll (claim + swap; roll-into-next when tx size permits). |
| Web — Create Arena | Guarded by registry; duration presets; market-hours defaults; optional sponsor funding. |
| Web — Leaderboard & Creator page | From indexer; eligibility thresholds. |
| Web — Share | OG card + deep link per Arena. |
| Services | Indexer (events → Postgres), crank (start/settle), price SSE, registry sync. |
| Modes | `live` and `demo` with provenance badges. |
| Docs | The seven docs kept current; README with setup, env, tests, screenshots. |
| Proof | ≥ 1 real on-chain Arena with a real Back (USDC → asset via Jupiter) and, if the window allows, a real settlement + claim. |

### Post-hackathon (explicitly out)

- Partial/decaying reward retention on early exit.
- Position receipt tokens / secondary market for positions.
- Multi-asset Arenas, team Arenas, tournaments.
- Automated wash-trading screener job (manual for the seed set).
- Per-wallet multiplier caps and wallet clustering.
- Jupiter Trigger/Recurring ("auto-back weekly").
- Yield on idle reward pools.
- `@solana/kit` migration; TypeScript 7.
- Native mobile apps.
- Program freeze + audit.

## 2. Phases and calendar (ET)

| Phase | When | Output | Commits (approx.) |
| --- | --- | --- | --- |
| **0 — Architecture & product lock** | Sat 12 Sept | Seven docs, research notes, workspace + tooling scaffold, core package skeleton | 8 |
| **1 — Core engine** | Sat 12 → Sun 13 | `packages/core` complete with vectors; asset registry data (seed set); config schemas | 5 |
| **2 — Program** | Sun 13 → Mon 14 | Anchor program + tests in WSL; devnet deploy; IDL client package | 6 |
| **3 — Web foundation & Arena UI** | Mon 14 → Tue 15 | Design tokens, layout, ArenaCard/Hero, Home, Arena page in demo mode | 6 |
| **4 — Live wiring** | Tue 15 → Wed 16 | Wallet, indexer, Pyth proxy + SSE, Jupiter quote/build, Back flow, My Arenas, crank | 6 |
| **5 — Create, Leaderboard, Share, Victory Roll** | Wed 16 → Thu 17 | Remaining surfaces; OG cards; polish; responsive pass | 5 |
| **6 — Mainnet proof, submission** | Thu 17 → Fri 18 noon | Deploy (mainnet or devnet per §5), run a real Arena, record video, README screenshots, submit | 3 |

Total ≈ 39 commits. Submission edits allowed until close; freeze at
Fri 18 Sept 12:00 ET to leave buffer.

## 3. Demo script (≤ 3 min video + live link)

1. Home: tagline, hero BONK vs TSLAx live with countdown and backing split.
2. "Tribe is not a bet" — 10-second explanation over the How Tribe Works row.
3. Arena page: five-second read; open rules drawer (fees, price source,
   underdog rule).
4. Back BONK with 5 USDC: preview shows Jupiter route, slippage, fee split,
   1.6× underdog, eligibility. Sign once. Position appears; Solscan link.
5. Back TSLAx with existing holdings from a second wallet (shows the
   Token-2022 path).
6. My Arenas: PnL vs Arena performance side by side, exit consequence
   copy.
7. A settled demo Arena: winner moment, CLAIM vs VICTORY ROLL; roll into the
   next Arena.
8. Create Arena: PENGU vs DISx with a sponsored pool.
9. Leaderboard and creator page. Share card.
10. Close on the tagline.

## 4. Submission checklist

- [ ] Register on the Stocklana site; Submit Project with: GitHub
      (`github.com/0xnald/tribe`), live demo URL (Vercel), video.
- [ ] README: concept, how it works, why Solana, architecture, integrations,
      screenshots, setup, env, tests, hackathon context, open-source notice.
- [ ] Docs current; `TRIBE_MODE=live` deployment with at least one live
      Arena and demo Arenas badged.
- [ ] Program id, deployed cluster, and tx links in README.
- [ ] Original work statement; list open-source components (Anchor, Pyth,
      Jupiter, Radix, Motion, …).
- [ ] Teammates invited from the submit form (if any).

## 5. Decisions required from the team

| # | Decision | Default if no answer |
| --- | --- | --- |
| 1 | **Mainnet program deployment** (≈ 2–3 SOL rent + crank SOL) vs devnet program + mainnet swaps | Devnet program; one mainnet Jupiter swap demonstrated; documented split |
| 2 | Pyth Terminal API key (free trial) — needed for live prices and crank | Create during Phase 4; demo mode until then |
| 3 | Jupiter API key (developers.jup.ag) | Same |
| 4 | Helius RPC + webhook (free tier) | Public RPC + `onLogs` polling |
| 5 | Vercel + Neon accounts | Local PGlite; deploy at Phase 6 |
| 6 | First-party Arena creator share → `RewardPool` (recommended) | RewardPool |
| 7 | Name for the protocol treasury / Upset Reserve authority (multisig?) | Single key for the hackathon, documented |

## 6. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Anchor toolchain in WSL fails or is slow (no Solana CLI installed yet; rustc 1.73 too old) | Program slips a day | Install Agave 4.2 + Anchor 1.2 via avm first thing in Phase 2; fallback: Docker `solanafoundation/anchor` image |
| `pyth-solana-receiver-sdk` 2.0 vs `anchor-lang` 1.2 compatibility | Settlement verification blocked | Pin versions in a spike before writing instructions; fallback: parse `PriceUpdateV2` manually (layout is stable) |
| Composed tx (Jupiter build + back) exceeds size | Two-signature fallback | Implemented from the start; xStocks routes are single-hop on Orca today |
| Equity feeds closed over the weekend of the demo window | Stock side frozen in the demo | Schedule the live demo Arena for Mon–Fri RTH; demo Arenas for weekends |
| Pyth/Jupiter key rate limits during judging | Stale UI | Server-side caching + SSE fan-out; demo mode fallback |
| Scope creep in UI | Missing must-ship items | Home, Arena, Back, My Arenas first; Create/Leaderboard after |
| xStocks pause/permanent-delegate actions during the live Arena | Confusing demo | Explained in UI; cancellation path documented |

## 7. Definition of done for the hackathon build

- `pnpm lint && pnpm typecheck && pnpm test` green; `anchor test` green.
- Live deployment loads in < 2 s on mobile; Arena page passes the
  five-second test with three people who have never seen it.
- One real Back transaction and one real position visible on-chain.
- Every doc in `docs/` matches the code (no stale numbers).

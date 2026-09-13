# Tribe — Design System

> **Status:** Source of truth for visual language. Every screen built later
> must be derivable from this document. The Arena is the star; everything
> else is stage.

---

## 1. Principles

1. **Five-second Arena.** Two names, two numbers, who leads, how long is
   left, one button. Everything else is secondary hierarchy.
2. **Neutral stage, bright fighters.** Structural surfaces are quiet warm
   neutrals; colour belongs to the two assets and to Tribe's signature
   accents. Never more than three saturated hues on screen at once.
3. **Big type is the chart.** Performance is read from large numerals and a
   single split bar, not from dashboards of sparklines.
4. **Financial enough to trust.** Tabular numerals, precise units, explicit
   sources, explicit fees, no ambiguous rounding.
5. **Fun without being childish.** Energy comes from motion, scale, and
   contrast — not from emoji, mascots, or gradient soup.
6. **Not** a purple-gradient Web3 dashboard, **not** a Bloomberg terminal,
   **not** generic SaaS.

## 2. Colour

### 2.1 Structural (neutral) tokens

Dark is the default theme (the Arena reads best on ink); light is fully
supported via `prefers-color-scheme` and a manual toggle.

| Token           | Dark          | Light          | Use                                                         |
| --------------- | ------------- | -------------- | ----------------------------------------------------------- |
| `--bg`          | `#0E0F12` Ink | `#F6F3EC` Bone | page background                                             |
| `--bg-elev`     | `#15171C`     | `#FFFFFF`      | cards, sheets                                               |
| `--bg-sunken`   | `#0A0B0D`     | `#EEEAE1`      | wells, bars background                                      |
| `--line`        | `#262930`     | `#E2DDD2`      | hairlines                                                   |
| `--line-strong` | `#3A3E48`     | `#C9C3B6`      | focus/hover borders                                         |
| `--fg`          | `#F4F1EA`     | `#121317`      | primary text                                                |
| `--fg-muted`    | `#9A9FAA`     | `#5F6470`      | secondary text                                              |
| `--fg-faint`    | `#8A8F9A`     | `#5D6270`      | tertiary text (still 4.5:1 on cards); disabled uses opacity |

### 2.2 Tribe accents

| Token     | Value     | Use                                                                                             |
| --------- | --------- | ----------------------------------------------------------------------------------------------- |
| `--volt`  | `#D9FF3D` | signature: primary CTA fill, LIVE dot, winner glow, key highlights. Text on volt is always Ink. |
| `--ember` | `#FF4D1F` | urgency: lead change flash, "ending soon", streak fire.                                         |
| `--ultra` | `#2F5BFF` | informational links, focus ring (dark), selected state.                                         |
| `--rise`  | `#19C37D` | positive performance.                                                                           |
| `--fall`  | `#F03E5A` | negative performance.                                                                           |
| `--gold`  | `#F5B301` | sponsored pools, rewards, Victory Roll.                                                         |

Rules: Volt is the only accent allowed as a large fill. Ember appears in
flashes and small badges, never as a background block. Rise/Fall colour
numbers and arrows only, never large surfaces.

### 2.3 Asset colours

Each asset has one brand hue used for its chip, its half of the backing bar,
its glow, and its CTA. Hues are chosen so any seed pairing is distinct
(ΔE > 25) and all pass 3:1 against `--bg` for non-text use. Text is never
set in asset colour; it sits on an asset-tinted surface with `--fg`.

| Asset | Hex       | Note                                                                            |
| ----- | --------- | ------------------------------------------------------------------------------- |
| BONK  | `#FF8A1F` | orange                                                                          |
| TSLAx | `#E31937` | Tesla red                                                                       |
| SOL   | `#19E0A0` | Solana green                                                                    |
| SPYx  | `#2559CC` | index blue (darkened in Phase 3 so Bone text on it passes 4.5:1)                |
| BTC   | `#F7931A` | bitcoin orange (never paired with BONK)                                         |
| MSTRx | `#FF5E1F` | strategy orange-red (paired with BTC: BTC uses `--gold` tint variant `#F2C14E`) |
| PENGU | `#7FD1FF` | ice blue                                                                        |
| DISx  | `#1E3BB8` | Disney navy                                                                     |
| NVDAx | `#76B900` | NVIDIA green                                                                    |
| AAPLx | `#B8BCC6` | space grey                                                                      |
| WIF   | `#D9A066` | tan                                                                             |
| GMEx  | `#C62828` | GME red (darkened in Phase 3 so Bone text on it passes 4.5:1)                   |
| GLDx  | `#E6B422` | gold                                                                            |

Tints: `color-mix(in oklab, var(--asset) 14%, var(--bg-elev))` for surfaces,
`… 32%` for bars in light mode, full hue for bars in dark mode.

Text on an asset fill (`BACK BONK`) is Ink or Bone, whichever contrasts
more (`apps/web/src/lib/color.ts:onAsset`), so dark hues (DISx, SPYx, GMEx)
get Bone. Accents used _as text_ have theme-safe variants
(`--volt-fg`, `--gold-fg`, `--ember-fg`, `--devnet-fg`, and darker
`--rise`/`--fall` in light) so every label passes 4.5:1 in both themes.

### 2.4 Contrast

Body text ≥ 4.5:1, large numerals ≥ 3:1, non-text UI ≥ 3:1 (WCAG 2.2 AA).
Volt on Ink: 15.6:1. Ink on Volt: 15.6:1. Bone text on Ink: 16.8:1.

## 3. Typography

| Role      | Family                                             | Notes                                               |
| --------- | -------------------------------------------------- | --------------------------------------------------- |
| Display   | **Bricolage Grotesque** (variable, `opsz`, `wdth`) | headlines, Arena names, big percentages             |
| Body / UI | **Inter** (variable)                               | `font-feature-settings: "tnum", "ss01"` for numbers |
| Mono      | **JetBrains Mono**                                 | addresses, signatures, tx previews                  |

Loaded via `next/font/google` with `display: swap` and system fallbacks.

Scale (px / line-height / weight):

| Token               | Size                                        | Use                                                         |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `hero-num`          | 96 / 1.0 / 700 (tnum)                       | Arena performance on the Arena page (desktop); 56 on mobile |
| `display-xl`        | 64 / 1.02 / 700, `wdth 90`                  | homepage tagline                                            |
| `display-lg`        | 44 / 1.05 / 700                             | Arena names in hero                                         |
| `display-md`        | 32 / 1.1 / 700                              | card asset names                                            |
| `h1`                | 32 / 1.2 / 700 (Inter)                      | page titles                                                 |
| `h2`                | 24 / 1.25 / 600                             | sections                                                    |
| `h3`                | 18 / 1.3 / 600                              | card titles                                                 |
| `body`              | 16 / 1.5 / 400                              |                                                             |
| `small`             | 14 / 1.45 / 400                             |                                                             |
| `micro`             | 12 / 1.35 / 500, tracking 0.04em, uppercase | labels: LIVE, DEMO, BACKING                                 |
| `num-lg` / `num-md` | 28 / 20, tabular                            | money, counts                                               |

Percentages always show sign and two decimals (`+8.42%`), money uses
locale grouping with USDC suffix in UI (`$184,291`), token amounts show up
to 6 significant digits with the symbol.

## 4. Spacing, layout, shape

- Base unit 4 px; spacing scale `1,2,3,4,6,8,12,16,24,32` × 4.
- Container `max-width: 1200px`, padding 16 (mobile) / 24 / 32.
- Grid: 4 columns mobile, 8 tablet, 12 desktop. Arena cards span 4/4/4
  (three per row), hero spans full.
- Radii: `--r-sm 8`, `--r-md 12`, `--r-lg 16`, `--r-xl 24`, `--r-arena 20`,
  pill `999`.
- Elevation: dark theme uses borders + subtle inner glow, not drop shadows;
  light theme uses `0 1px 2px rgba(18,19,23,.06), 0 8px 24px rgba(18,19,23,.06)`.
- Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1280`. Mobile-first.

## 5. Motion

| Token           | Value                                              |
| --------------- | -------------------------------------------------- |
| `--dur-fast`    | 120 ms (hover, toggles)                            |
| `--dur-base`    | 200 ms (sheets, chips)                             |
| `--dur-slow`    | 320 ms (bar changes, number rolls)                 |
| `--dur-moment`  | 600–900 ms (lead change, settlement, Victory Roll) |
| `--ease-out`    | `cubic-bezier(.2,.8,.2,1)`                         |
| `--ease-spring` | Motion spring `{ stiffness: 420, damping: 32 }`    |

Moments (Motion / CSS):

- **Live dot** — 1.2 s breathing pulse in Volt.
- **Countdown** — digits roll vertically (`--dur-slow`); last 60 s tint Ember.
- **Performance numbers** — animated number rolls on update; colour cross-fades
  Rise/Fall.
- **Backing bar** — width animates with spring; a thin Volt "delta" segment
  shows the most recent change for 1 s.
- **Lead change** — the new leader's name gets an Ember underline sweep and
  the VS mark pulses once (`--dur-moment`).
- **Back success** — CTA morphs into a checkmark, position card slides in
  from bottom with asset-tint glow.
- **Settlement / winner** — winner side scales 1.0→1.04→1.0 with Volt glow;
  loser side desaturates 30%; confetti is **not** used.
- **Victory Roll** — reward pill "rolls" (rotateX) into the asset chip.
- **Skeletons** — 1.4 s shimmer on `--bg-sunken`.

`prefers-reduced-motion: reduce` → all of the above become opacity/colour
changes ≤ 150 ms; number rolls become instant; pulses stop.

## 6. Core components

### 6.1 `ProvenanceBadge`

`LIVE` (Volt dot + micro label), `DEMO` (Ash outline, micro), `FIXTURE`
(dashed outline). Required on every Arena surface and every position.

### 6.2 `AssetChip`

Logo (24/32/48), symbol in `display-md`, optional class tag (`MEME`,
`STOCK`, `ETF`, `INDEX`, `COMMODITY`, `L1`). Surface tinted with the asset
hue.

### 6.3 `PerfReadout`

Signed percentage in tabular display type, arrow glyph, Rise/Fall colour,
small "since start" caption, price mode tag when `LastKnown` ("last close").

### 6.4 `BackingBar`

Single horizontal bar split by USD backing share; asset hues; percentage
labels at both ends; underdog side shows a `MultiplierTag` (`1.6× underdog`)
when > 1.0×. Height 12 (cards) / 20 (hero).

### 6.5 `Countdown`

`HH:MM:SS` in mono-spaced display digits; label switches between
`OPENS IN`, `LIVE`, `BACKING CLOSES IN`, `ENDS IN`, `SETTLING`, `SETTLED`.

### 6.6 `ArenaCard` (Explore grid)

```
┌─────────────────────────────────────────────┐
│ ● LIVE · 01:42:18                    $184K ▸ │  micro row: status, countdown, backing
│                                              │
│  BONK             VS             TSLAx       │  display-md names, tinted halves
│  +8.42% ▲                        +2.17% ▲    │  PerfReadout ×2
│                                              │
│ ████████████████████░░░░░░░░ 73% BONK        │  BackingBar
│ 4,821 backers · Pool $4,000 · 1.6× underdog  │  small row
│ [ BACK BONK ]              [ BACK TSLAx ]    │  two CTAs (asset-tinted, Ink text)
└─────────────────────────────────────────────┘
```

Sizes: `default` (grid), `compact` (lists, 2 rows, no CTAs), `wide` (Ending
Soon rail). Whole card is a link; CTAs are separate buttons.

### 6.7 `ArenaHero` (Arena page top / homepage featured)

Full-width stage. Left asset, VS mark (Bricolage, `wdth 75`, outlined),
right asset. `hero-num` performance under each name. Below: BackingBar
(20 px), stat row (backing, backers, pool, sponsor), dual CTA row. On
mobile the two assets stack as two tinted halves with the VS mark between
them and CTAs pinned to the bottom of the viewport.

### 6.8 `BackSheet` (entry flow)

Radix Dialog on desktop (480 px), bottom sheet on mobile. Steps: side →
method (USDC / existing holdings, showing balances) → amount (quick chips
25/50/100/MAX) → preview (estimated units, route + venue, slippage, Tribe
fee with split, expected position, current multiplier, reward eligibility,
backing closes in) → sign → success (position card). Every number in the
preview is labelled with its source (Jupiter quote, Pyth reference).

### 6.9 `PositionCard` (My Arenas)

Asset chip, units + USD value, asset PnL (Rise/Fall), Arena relative
performance, time held, current reward weight, projected share **(labelled
"estimate")**, actions: Add, Exit (with consequence copy), Claim, Victory
Roll.

### 6.10 `ShareCard` (OG 1200×630)

Ink background, two asset-tinted halves, names in `display-lg`, performance
in `hero-num`, `BONK LEADS` in Volt, backing and time left in micro, Tribe
wordmark and "Back your tribe." bottom-left. Generated by
`/api/og/[arenaId]` with `next/og`.

### 6.11 Buttons

`primary` (Volt fill, Ink text), `asset` (asset hue fill, Ink text),
`secondary` (line, `--fg`), `ghost`, `danger` (Fall). Height 44 (touch
target) / 40 desktop dense. Focus ring 2 px Ultra with 2 px offset.

### 6.12 Navigation

Top bar: wordmark, Explore, Create Arena, Leaderboard, My Arenas, wallet
button (wallet-adapter styled to this system). Mobile: bottom tab bar with
five items; Create is the centre Volt action.

## 7. Copy voice

Second person, present tense, verbs first. Short.

| Situation    | Copy                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| Hero         | _Don't bet on what you believe in. Own it._                                                  |
| CTA          | `BACK BONK`                                                                                  |
| Success      | _You own 1,240,000 BONK. It's in the Arena._                                                 |
| Exit warning | _Exiting now forfeits this position's Arena Rewards. Your BONK is returned to your wallet._  |
| Late         | _Backing closed 12 minutes ago. You can still buy BONK — it just won't count in this Arena._ |
| Demo         | _Demo Arena — simulated prices, no transaction._                                             |
| Market hours | _TSLAx reference price updates during US market hours only._                                 |
| Draw         | _DRAW. Pool rolls into the next BONK vs TSLAx Arena._                                        |
| Win          | _BONK WINS. Your Arena Reward: 480 USDC._                                                    |

Avoid: "bet", "wager", "odds", "payout ratio", "leverage", "moon".

## 8. Accessibility

- All interactive elements keyboard reachable with visible focus.
- Colour is never the only carrier: performance has sign + arrow; sides
  have names; bars have labels.
- Live regions: performance and countdown updates are `aria-live="polite"`
  and throttled to once per 10 s for screen readers.
- Touch targets ≥ 44 px. Reduced motion honoured (§5).
- Number formatting via `Intl.NumberFormat` with explicit currency/unit.

## 9. Implementation notes

- Tokens are CSS custom properties defined in `apps/web/src/styles/tokens.css`
  and mapped into Tailwind v4 `@theme`.
- Asset colours live in `packages/core/src/assets/colors.ts` and are the
  single source for UI and OG rendering.
- Components: `apps/web/src/components/{arena,ui,layout}`; primitives from
  `radix-ui`; motion from `motion/react`.
- Icons: Lucide (outline, 1.75 px stroke). Asset logos from the registry
  (xStocks logo URLs, Jupiter token icons), with a monogram fallback in the
  asset hue.

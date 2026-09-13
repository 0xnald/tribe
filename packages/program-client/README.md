# @tribe/program-client

Typed client for the `tribe_arena` Anchor program: PDA derivation,
instruction builders for every instruction, account fetchers and the
transaction compositions the app uses.

```ts
import { TribeClient, readonlyProvider, TRIBE_ARENA_PROGRAM_ID } from '@tribe/program-client';

const client = new TribeClient(readonlyProvider(connection), TRIBE_ARENA_PROGRAM_ID);
const arena = await client.fetchArena(arenaPda);
const cfg = await client.fetchConfig();
// first Back on a side: open the position (idempotent) + back in one tx
const ixs = await client.openAndBack(owner, arenaPda, arena, cfg, 0, units, feeUsdc);
// swap-then-back: Jupiter instructions first, `back` with the route's guaranteed minimum output
const ixs2 = await client.composeSwapAndBack(
  jupiterIxs,
  owner,
  arenaPda,
  arena,
  cfg,
  0,
  minOut,
  fee,
);
```

`src/idl/` holds the generated IDL (`anchor idl build`, copied by
`scripts/build-program.sh`). `src/pyth.ts` encodes/decodes Pyth
`PriceUpdateV2` accounts (used by tests to build receiver-owned fixtures).

## Tests

`pnpm test` runs the unit tests (PDAs, codec). `pnpm test:program` runs the
24 integration scenarios against the built program under
[solana-bankrun](https://github.com/kevinheavey/solana-bankrun) — Linux/macOS/WSL
only; it needs `programs/tribe_arena/target/deploy/tribe_arena.so`
(`scripts/build-program.sh`) and the mainnet Token-2022 binary in
`tests/fixtures` (`pnpm fixtures`, see `tests/fixtures/README.md`).

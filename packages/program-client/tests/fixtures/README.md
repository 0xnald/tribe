# Test fixtures

## `spl_token_2022.so`

Bankrun (`solana-program-test` 1.18) bundles a Token-2022 build that predates
the `ScaledUiAmount` and `Pausable` extensions used by xStocks. The program
tests therefore load the mainnet Token-2022 binary at the canonical address
`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`, dumped with:

```bash
solana program dump -u m TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb spl_token_2022.so
```

The file is not committed. Run `pnpm --filter @tribe/program-client fixtures`
(or the command above) once; the harness fails with a clear message when it is
missing. Verify against the on-chain program with `solana program show`.

# Deployments

Mainnet is intentionally **not** deployed. Devnet only. Mainnet deployment is
gated on the review in `MAINNET_CUTOVER.md`.

## Pending: Q10 upgrade of the devnet program (not yet executed)

The program on devnet is still the **Q8 build** below (`bd7da498…`). The Q10
release build is ready and reproducible, but the upgrade is blocked on
devnet SOL: the upgrade buffer needs 3.249 SOL of rent (refunded when the
buffer is consumed) plus the `extend` of the ProgramData account by
752 bytes, and the deployer `GrUT28…` holds 1.724 SOL. The public devnet
faucet answered "airdrop limit today" for every request on 2026-09-15/16.

| Field          | Value                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release commit | `9e84e53` (program sources unchanged since `04d16d5`, the Q10 migration)                                                                                |
| Build          | `scripts/build-program.sh` in WSL Ubuntu-24.04: `cargo build-sbf --arch v0`, Anchor 1.2.0, Agave 4.2.2                                                  |
| Binary         | `target/deploy/tribe_arena.so`, **639 536 bytes**, sha256 `2588ad7e8d106c53a5ec1a4ae6a9c879724737d5e77001d7404c139afef1ef5e` (rebuilt twice, identical) |
| IDL            | `target/idl/tribe_arena.json` == `packages/program-client/src/idl/tribe_arena.json` (price fields `priceQ10`)                                           |
| Program id     | `shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4` (unchanged; same keypair is planned for mainnet)                                                          |
| Needed to run  | ≈ 1.6 SOL more on `GrUT28TocKAAo5BDfV9wQejZ1aQsVTNpynYGjLjzwykf` (devnet)                                                                               |

Resume procedure once funded (WSL, `~/tribe` mirror at the release commit):

```bash
solana program extend shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4 800 -u devnet -k ~/tribe-keys/devnet-deployer.json
scripts/deploy-devnet.sh                      # upgrade; same buffer keypair, resumable
solana program dump shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4 /tmp/onchain.so -u devnet
head -c 639536 /tmp/onchain.so | sha256sum   # must equal 2588ad7e…
DEVNET_SMOKE=1 DEVNET_AUTHORITY_KEYPAIR=$HOME/tribe-keys/devnet-deployer.json pnpm --filter @tribe/program-client smoke:devnet
DEVNET_SETUP=1 DEVNET_ARENA_SECS=3600 DEVNET_TBONK=FhvxjAUEQ5W1zrfXGnd6QuzLaTaiDkbEY2aEWvjLCSuT DEVNET_TSOL=348Kk3CBtzwTHvLMN3wd9yipsqvzJ1u4ST6E7mBNKZe3   DEVNET_AUTHORITY_KEYPAIR=$HOME/tribe-keys/devnet-deployer.json   pnpm --filter @tribe/program-client exec vitest run --config vitest.program.config.ts tests/devnet-setup.test.ts
```

Expected Q10 start snapshot: BONK `priceQ10` ≈ 27 000–28 000 (USD × 1e10),
SOL ≈ 2.1 × 10¹² for a $210 price. The existing live devnet Arena
`9c4aWKn3d4vCfMs7zoW4XBBCLrfegWfEABh2K7U2m5KR` was created by the Q8 build
and keeps Q8 snapshots; the web app reads on-chain snapshots as Q10, so that
Arena will display wrong prices until it is replaced (it ends 2026-09-14 +
24 h and is being left to expire).

## `tribe_arena` (current devnet deployment — Q8 build)

| Field                | Value                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cluster              | devnet (`https://api.devnet.solana.com`)                                                                                                                                                                                                                        |
| Program id           | `shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4`                                                                                                                                                                                                                   |
| ProgramData          | `G7GHfVvQC4qYf5EqzqwCwChFQMcJ2BVsfdc6tu9rZr5k`                                                                                                                                                                                                                  |
| Upgrade authority    | `GrUT28TocKAAo5BDfV9wQejZ1aQsVTNpynYGjLjzwykf` (devnet deployer key; also the protocol `authority` in `ProtocolConfig`)                                                                                                                                         |
| Deployment signature | `4PGtEY2xfZJYkfCFfCQLVUca5Ush573mHoYHxoZvJCDeBfAWodseY1rsMWHjnxqssJjsMHcxApURBCuR7SANiuvU`                                                                                                                                                                      |
| Deployed             | 2026-09-13 14:11:42 UTC, slot 497751084                                                                                                                                                                                                                         |
| Build                | commit `2765f48`, `cargo build-sbf --arch v0`, Anchor 1.2.0, Agave 4.2.2; 638 784 bytes; sha256 `bd7da49883a68e363ac7bd7a806852e88288b02fcae214dd7cb6d6da978a3780` (on-chain bytes identical)                                                                   |
| Explorer             | [program](https://explorer.solana.com/address/shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4?cluster=devnet) · [deploy tx](https://explorer.solana.com/tx/4PGtEY2xfZJYkfCFfCQLVUca5Ush573mHoYHxoZvJCDeBfAWodseY1rsMWHjnxqssJjsMHcxApURBCuR7SANiuvU?cluster=devnet) |

### Verification

- `solana program show` → owner `BPFLoaderUpgradeab1e11111111111111111111111`, executable, data
  length 638 784, authority as above.
- `solana program dump` of the on-chain program hashes to the same sha256 as
  the local `target/deploy/tribe_arena.so` built at commit `2765f48`.

### Post-deploy smoke test (`pnpm --filter @tribe/program-client smoke:devnet`)

Real transactions through `@tribe/program-client` against devnet, all confirmed:

| Step                                                                                                                             | Signature                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `init_config` (devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, treasury = authority ATA, upset reserve = config ATA) | `278RS4xbZUE4yjKfRjRH4kpPHvziGbZ9Mc6rDWs53ywKUXu9qcaBX5FDPLfPoy11zRNXvkDXiGTwiZeEmEYyYHX8` |
| `set_paused(true)` + read-back                                                                                                   | `2m9dYSumi55c3CbpLyUF2QUwsJze2vXHV5xP9n4Hw8h344Nyxax7422gA6TuJVgBrFWhZgTZGzsNdHyE9cvenWjz` |
| `set_paused(false)` + read-back                                                                                                  | `2ZYEgbK1RA6RUwTJ9g7HVw8MwZZtDbGp6iNq7tcowjdkQaf3NHTT3EUSseRPsLgYNRnfUKjoywJnVpJtA1NA35c9` |

Config PDA: `["config"]` of the program id; fee policy 50 bps 40/40/20,
limits and default params as in `tests/devnet-smoke.test.ts`.

### Procedure (repeatable)

```bash
scripts/build-program.sh     # fmt, clippy -D warnings, vector parity, SBF v0 build, IDL
scripts/deploy-devnet.sh     # resumable: persistent buffer keypair, up to 6 passes, TPU path
```

Keys: the program keypair, the deployer keypair and the deploy buffer keypair
live outside the repository (`~/tribe-keys/`); `.gitignore` also excludes
`*keypair*.json`, `keys/` and `wallet*.json`.

Lessons from this deployment (also in RESEARCH_NOTES §8): the public devnet
RPC throttles buffer writes (`--use-rpc` failed twice with "Max retries
exceeded"); the TPU path loses a few percent of writes per pass, so the script
now reuses one buffer keypair and retries until the upload is complete.
Abandoned buffers were closed and their lamports recovered.

Upgrades use the same script (the program is upgradeable during the
hackathon; moving the authority to a multisig is listed in SECURITY §4 as
post-hackathon work).

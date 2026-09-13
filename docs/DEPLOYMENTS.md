# Deployments

Mainnet is intentionally **not** deployed during Phase 2. Devnet only.

## `tribe_arena`

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

# Deployments

Mainnet is intentionally **not** deployed during Phase 2. Devnet only.

## `tribe_arena`

| Field                | Value                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Program id           | `shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4`                                                  |
| Cluster              | devnet (`https://api.devnet.solana.com`)                                                       |
| Upgrade authority    | `GrUT28TocKAAo5BDfV9wQejZ1aQsVTNpynYGjLjzwykf` (devnet deployer key)                           |
| Build                | `cargo build-sbf --arch v0`, Anchor 1.2.0, Agave 4.2.2, commit below                           |
| Deployment signature | _pending — see status_                                                                         |
| Explorer             | https://explorer.solana.com/address/shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4?cluster=devnet |

### Status

The build artifact (`target/deploy/tribe_arena.so`, 638 784 bytes, needs
≈ 4.5 SOL of rent) and the deploy script are ready; the deployment itself is
blocked on devnet SOL: the CLI faucet (`solana airdrop`, all sizes, several
RPC providers) refused every request on 2026-09-13 with its per-IP rate
limit. To complete it:

1. Fund the upgrade authority `GrUT28TocKAAo5BDfV9wQejZ1aQsVTNpynYGjLjzwykf`
   with ≥ 5 devnet SOL (https://faucet.solana.com, or any devnet wallet).
2. In WSL Ubuntu-24.04: `scripts/deploy-devnet.sh` (uses the program keypair
   and deployer key from `~/tribe-keys/`, never from the repo).
3. Record the signature and the `solana program show` output in this file.

Keys: the program keypair and the deployer keypair live outside the
repository (`~/tribe-keys/`); `.gitignore` also excludes `*keypair*.json`,
`keys/` and `wallet*.json`.

### Procedure (repeatable)

```bash
scripts/build-program.sh     # fmt, clippy -D warnings, vector parity, SBF v0 build, IDL
scripts/deploy-devnet.sh     # solana program deploy … --url devnet --upgrade-authority <deployer>
```

Upgrades use the same script (the program is upgradeable during the
hackathon; moving the authority to a multisig is listed in SECURITY §4 as
post-hackathon work).

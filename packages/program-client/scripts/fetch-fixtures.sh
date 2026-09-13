#!/usr/bin/env bash
# Dump the mainnet Token-2022 program for bankrun tests (read-only RPC, no fees).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tests/fixtures
solana program dump -u m TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb tests/fixtures/spl_token_2022.so
sha256sum tests/fixtures/spl_token_2022.so

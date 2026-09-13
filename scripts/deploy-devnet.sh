#!/usr/bin/env bash
# Deploy tribe_arena to DEVNET only. Never point this at mainnet.
# Requires: target/deploy/tribe_arena.so (scripts/build-program.sh), the program
# keypair (kept outside the repo) and a devnet-funded upgrade authority.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-$HOME/tribe-keys/tribe_arena-keypair.json}"
AUTHORITY="${AUTHORITY:-$HOME/tribe-keys/devnet-deployer.json}"
URL="https://api.devnet.solana.com"
PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
echo "program id: $PROGRAM_ID"
echo "authority : $(solana-keygen pubkey "$AUTHORITY")  balance: $(solana balance -u "$URL" -k "$AUTHORITY")"
solana program deploy target/deploy/tribe_arena.so \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$AUTHORITY" \
  --upgrade-authority "$AUTHORITY" \
  --url "$URL" \
  --with-compute-unit-price 1000 \
  --max-sign-attempts 30 \
  --use-rpc
solana program show "$PROGRAM_ID" -u "$URL"

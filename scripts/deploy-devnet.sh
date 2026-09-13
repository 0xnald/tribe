#!/usr/bin/env bash
# Deploy tribe_arena to DEVNET only. Never point this at mainnet.
# Requires: target/deploy/tribe_arena.so (scripts/build-program.sh), the program
# keypair (kept outside the repo) and a devnet-funded upgrade authority.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-$HOME/tribe-keys/tribe_arena-keypair.json}"
AUTHORITY="${AUTHORITY:-$HOME/tribe-keys/devnet-deployer.json}"
# Persistent buffer keypair: a partial upload is resumed instead of restarted,
# so flaky RPC/TPU passes accumulate progress rather than leaking a buffer each time.
BUFFER="${BUFFER:-$HOME/tribe-keys/devnet-buffer.json}"
[ -f "$BUFFER" ] || solana-keygen new --no-bip39-passphrase -s -o "$BUFFER" >/dev/null
URL="https://api.devnet.solana.com"
PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
echo "program id: $PROGRAM_ID"
echo "authority : $(solana-keygen pubkey "$AUTHORITY")  balance: $(solana balance -u "$URL" -k "$AUTHORITY")"
echo "buffer    : $(solana-keygen pubkey "$BUFFER")"
for attempt in 1 2 3 4 5 6; do
  echo "deploy pass $attempt"
  if solana program deploy target/deploy/tribe_arena.so \
    --program-id "$PROGRAM_KEYPAIR" \
    --buffer "$BUFFER" \
    --keypair "$AUTHORITY" \
    --upgrade-authority "$AUTHORITY" \
    --url "$URL" \
    --with-compute-unit-price 1000 \
    --max-sign-attempts 100 \
    ${USE_RPC:+--use-rpc}; then
    break
  fi
  echo "pass $attempt failed; retrying with the same buffer"
  sleep 5
done
solana program show "$PROGRAM_ID" -u "$URL"
# The public devnet RPC rate-limits buffer writes (429 → "Max retries exceeded");
# the default TPU path is more reliable. Set USE_RPC=1 only if UDP/QUIC egress is blocked.
# If you abandon a deploy, close the buffer to recover its lamports:
#   solana program close "$(solana-keygen pubkey "$BUFFER")" -k "$AUTHORITY" -u devnet

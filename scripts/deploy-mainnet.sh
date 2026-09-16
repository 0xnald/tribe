#!/usr/bin/env bash
# Deploy tribe_arena to Solana MAINNET-BETA. Prepared for the canary; refuses to run
# unless CONFIRM_MAINNET=yes is set, and prints the full plan first.
#
# Pays: the upgrade authority keypair (AUTHORITY) pays the buffer rent, the
# ProgramData rent (max-len 800000 → ≈ 4.065 SOL) and all transaction fees.
# The program keypair only signs the creation of the program account.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-$HOME/tribe-keys/tribe_arena-keypair.json}"
AUTHORITY="${AUTHORITY:-$HOME/tribe-keys/mainnet-upgrade-authority.json}"
BUFFER="${BUFFER:-$HOME/tribe-keys/mainnet-buffer.json}"
URL="${MAINNET_RPC:?set MAINNET_RPC to a paid mainnet-beta RPC endpoint}"
SO="target/deploy/tribe_arena.so"
EXPECTED_SHA="${EXPECTED_SHA:-2588ad7e8d106c53a5ec1a4ae6a9c879724737d5e77001d7404c139afef1ef5e}"
MAX_LEN=800000

PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
AUTH_PK=$(solana-keygen pubkey "$AUTHORITY")
[ "$PROGRAM_ID" = "shzfcWWZtWWTMfRuEvdBAsJZUe3mYork3wug5z5U5w4" ] || { echo "unexpected program id $PROGRAM_ID"; exit 1; }
[ "$AUTH_PK" = "DWD51YpXjfWLxEKQTBkLZY9Gtx6gWnfXz6cz4wqbm8HZ" ] || { echo "unexpected authority $AUTH_PK"; exit 1; }
[ -f "$SO" ] || { echo "missing $SO — run scripts/build-program.sh at the release commit"; exit 1; }
ACTUAL_SHA=$(sha256sum "$SO" | cut -d' ' -f1)
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || { echo "binary sha256 $ACTUAL_SHA != release $EXPECTED_SHA"; exit 1; }
[ -f "$BUFFER" ] || solana-keygen new --no-bip39-passphrase -s -o "$BUFFER" >/dev/null

cat <<EOF
== mainnet deployment plan (nothing executed yet)
cluster    : mainnet-beta ($URL)
program id : $PROGRAM_ID
binary     : $SO ($(stat -c %s "$SO") bytes) sha256 $ACTUAL_SHA
max-len    : $MAX_LEN
authority  : $AUTH_PK  balance $(solana balance -u "$URL" -k "$AUTHORITY")
buffer     : $(solana-keygen pubkey "$BUFFER") (resumable; closed automatically on success)
payer      : $AUTH_PK (buffer rent ≈ 3.25 SOL, ProgramData rent ≈ 4.065 SOL, fees)
command    :
  solana program deploy $SO \\
    --program-id $PROGRAM_KEYPAIR \\
    --buffer $BUFFER \\
    --keypair $AUTHORITY \\
    --upgrade-authority $AUTHORITY \\
    --max-len $MAX_LEN \\
    --url $URL \\
    --with-compute-unit-price 20000 \\
    --max-sign-attempts 100 \\
    --use-rpc
EOF

[ "${CONFIRM_MAINNET:-}" = "yes" ] || { echo "CONFIRM_MAINNET=yes not set — stopping before any transaction."; exit 0; }

for attempt in 1 2 3; do
  echo "deploy pass $attempt"
  if solana program deploy "$SO" \
    --program-id "$PROGRAM_KEYPAIR" \
    --buffer "$BUFFER" \
    --keypair "$AUTHORITY" \
    --upgrade-authority "$AUTHORITY" \
    --max-len "$MAX_LEN" \
    --url "$URL" \
    --with-compute-unit-price 20000 \
    --max-sign-attempts 100 \
    --use-rpc; then
    break
  fi
  echo "pass $attempt failed; retrying with the same buffer"
  sleep 5
done

solana program show "$PROGRAM_ID" -u "$URL"
solana program dump "$PROGRAM_ID" /tmp/tribe_arena.mainnet.so -u "$URL"
ONCHAIN_SHA=$(head -c "$(stat -c %s "$SO")" /tmp/tribe_arena.mainnet.so | sha256sum | cut -d' ' -f1)
echo "on-chain sha256 (first $(stat -c %s "$SO") bytes): $ONCHAIN_SHA"
[ "$ONCHAIN_SHA" = "$EXPECTED_SHA" ] && echo "HASH MATCH" || { echo "HASH MISMATCH — stop"; exit 1; }

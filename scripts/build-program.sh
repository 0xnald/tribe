#!/usr/bin/env bash
# Build tribe_arena for SBF (v0 ISA so bankrun/program-test can load it) and emit the IDL.
# Run from WSL/Linux/macOS with the toolchain from scripts/wsl-toolchain.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
cargo fmt --all --check
cargo clippy -p tribe_arena --all-targets -- -D warnings
cargo test -p tribe_arena
(cd programs/tribe_arena && cargo build-sbf --arch v0)
mkdir -p target/idl target/types
anchor idl build -p tribe_arena -o target/idl/tribe_arena.json -t target/types/tribe_arena.ts
# Keep the client's committed IDL in sync (prettier reformats it).
cp target/idl/tribe_arena.json packages/program-client/src/idl/tribe_arena.json
cp target/types/tribe_arena.ts packages/program-client/src/idl/tribe_arena.ts
cp target/types/tribe_arena_errors.ts packages/program-client/src/idl/tribe_arena_errors.ts
ls -la target/deploy/tribe_arena.so

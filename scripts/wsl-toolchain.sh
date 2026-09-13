#!/usr/bin/env bash
# Reproducible Solana/Anchor toolchain for WSL Ubuntu 24.04 (docs/RESEARCH_NOTES.md §8).
# Ubuntu 22.04 does not work: the prebuilt Anchor 1.2 binary needs glibc 2.39.
set -euxo pipefail
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"

sudo -n true 2>/dev/null && sudo apt-get update -qq && sudo apt-get install -y -qq build-essential pkg-config libssl-dev libudev-dev protobuf-compiler llvm libclang-dev clang cmake jq || true

# Rust: stable (Anchor 1.2 / Agave 4.2 need >= 1.85)
rustup self update || true
rustup update stable
rustup default stable
rustup component add rustfmt clippy
rustc --version

# Agave (Solana) CLI 4.2.x
if ! solana --version 2>/dev/null | grep -q "4.2"; then
  sh -c "$(curl -sSfL https://release.anza.xyz/v4.2.2/install)"
fi
solana --version

# Anchor 1.2.0 via avm
if ! command -v avm >/dev/null; then
  cargo install --git https://github.com/solana-foundation/anchor avm --force
fi
avm install 1.2.0 || true
avm use 1.2.0
anchor --version

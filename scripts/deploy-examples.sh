#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SDK_DIR="$ROOT_DIR/SpriteStudio-SDK"
PUBLIC_DIR="$ROOT_DIR/examples/pixi-example/public"

mkdir -p "$PUBLIC_DIR"

echo "Compiling SpriteStudio test assets..."
cd "$SDK_DIR"
cargo run -p ssconverter-cli -- -o "$PUBLIC_DIR" tests/overall/overall.sspj
cargo run -p ssconverter-cli -- -o "$PUBLIC_DIR" tests/Ringo/Ringo.sspj

echo "Deploy complete! The .ssab and related asset files have been copied to $PUBLIC_DIR."

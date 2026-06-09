#!/bin/bash
set -e

# Setup paths
PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
SDK_DIR="${PROJECT_ROOT}/SpriteStudio7-SDK"
TARGET_DIR="${PROJECT_ROOT}/packages/ssplayer-core/src"

echo "Generating FlatBuffers TypeScript code..."

# Create target directory if it doesn't exist
mkdir -p "${TARGET_DIR}"

# Run flatc to compile .fbs schemas
# We find all .fbs files in the SDK's libs directories
find "${SDK_DIR}/libs/ssab/fbs" "${SDK_DIR}/libs/ssruntime/fbs" -name "*.fbs" | xargs flatc --ts -o "${TARGET_DIR}"

echo "FlatBuffers generation complete. Output saved to ${TARGET_DIR}/fbs"

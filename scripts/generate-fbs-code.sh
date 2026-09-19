#!/bin/bash
set -eo pipefail

# Setup paths
HELP_APP="$(basename "$0")"
usage () {
    cat <<USAGE
Usage: ${HELP_APP} [--help]
  flatc --ts over the SDK's .fbs schemas, into packages/ssplayer-core/src/ss/,
  then rewrites the namespace entrypoints flatc overwrites per file. Needs flatc.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    -h|--help|help) usage; exit 0 ;;
    *) echo "${HELP_APP}: unknown argument '${arg}'" >&2; usage >&2; exit 2 ;;
  esac
done

PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
SDK_DIR="${PROJECT_ROOT}/SpriteStudio-SDK"
TARGET_DIR="${PROJECT_ROOT}/packages/ssplayer-core/src"

echo "Generating FlatBuffers TypeScript code..."

# Create target directory if it doesn't exist
mkdir -p "${TARGET_DIR}"

for f in "${SDK_DIR}/libs/ssruntime/fbs/"*.fbs; do
    flatc --ts -o "${TARGET_DIR}" "$f"
done

for f in "${SDK_DIR}/libs/ssab/fbs/"*.fbs; do
    flatc --ts -o "${TARGET_DIR}" "$f"
done

# flatc overwrites namespace entrypoints (like ss/runtime.ts and ss/format.ts)
# when run in a loop or with multiple files having the same namespace.
# We manually regenerate them to include all generated files.
for namespace in "runtime" "format"; do
    ENTRYPOINT="${TARGET_DIR}/ss/${namespace}.ts"
    echo "// Auto-generated entrypoint" > "${ENTRYPOINT}"
    echo "/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */" >> "${ENTRYPOINT}"
    for f in "${TARGET_DIR}/ss/${namespace}/"*.ts; do
        if [ -f "$f" ]; then
            name=$(basename "$f" .ts)
            # Find the exported classes/enums/functions in the file
            exports=$(grep -E "^export (class|enum|function) " "$f" | awk '{
                if ($2 == "function") {
                    split($3, a, "(");
                    print a[1];
                } else {
                    print $3;
                }
            }')
            for exp in $exports; do
                echo "export { ${exp} } from './${namespace}/${name}.js';" >> "${ENTRYPOINT}"
            done
        fi
    done
done

echo "FlatBuffers generation complete. Output saved to ${TARGET_DIR}"

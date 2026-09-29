#!/usr/bin/env pwsh
#
# Take a fresh checkout to a running example. PowerShell twin of run-example.sh.
#
#   scripts/run-example.ps1                     # examples/webgl-example: the <ss-player> demos
#   scripts/run-example.ps1 example=pixi        # or override, part-follow, sspj-preview
#
# Also `pnpm run example`. example=<webgl|pixi|override|part-follow|sspj-preview>, webgl by
# default. In order, each step only when its output is missing:
#
#   1. checks out the SpriteStudio-SDK submodule
#   2. pnpm install
#   3. the WASM: pnpm run download:wasm; while the SDK has published no release for it to
#      download, builds it from source (pnpm run build:wasm, which needs Rust and wasm-pack)
#   4. pnpm run build, the packages the examples consume
#   5. the example's assets (pnpm run deploy-examples)
#   6. starts the example's dev server and opens it (Ctrl-C stops it)
#
# Nothing checks whether an existing output is stale: after changing TypeScript under
# packages/, run pnpm run build yourself, and after changing Rust, pnpm run build:wasm.
$ErrorActionPreference = "Stop"

$APP = Split-Path -Leaf $PSCommandPath
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# Plain stderr + an exit code, rather than Write-Error's stack trace; matches
# run-example.sh (2 = bad usage, 1 = the environment is not ready).
function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${APP}: $Message")
    exit $Code
}

# Run a native command and stop the script with its exit code when it fails.
function Run {
    param([string] $Command, [string[]] $Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$EXAMPLE = "webgl"
foreach ($arg in $args) {
    if ($arg -in "-h", "--help") {
        Get-Content $PSCommandPath | Select-Object -Skip 1 -First 19 | ForEach-Object { $_ -replace '^# ?', '' }
        exit 0
    } elseif ($arg -like "example=*") {
        $EXAMPLE = $arg.Substring(8)
    } else {
        Fail "unknown argument '$arg' (see $APP --help)" 2
    }
}

$DIR = switch ($EXAMPLE) {
    { $_ -in "webgl", "pixi", "override" } { "$EXAMPLE-example" }
    { $_ -in "part-follow", "sspj-preview" } { $EXAMPLE }
    default { Fail "example must be webgl, pixi, override, part-follow or sspj-preview (got '$EXAMPLE')" 2 }
}

Set-Location $ROOT_DIR

function Missing {
    param([string[]] $Paths)
    foreach ($p in $Paths) { if (-not (Test-Path $p)) { return $true } }
    return $false
}

# --- 1. the SDK -----------------------------------------------------------
if (Missing "SpriteStudio-SDK/tests/Ringo/Ringo.sspj") {
    Write-Host ">> ${APP}: checking out the SpriteStudio-SDK submodule"
    Run git @("submodule", "update", "--init", "--recursive")
}

# --- 2. dependencies ------------------------------------------------------
if (Missing "node_modules") {
    Write-Host ">> ${APP}: pnpm install"
    Run pnpm @("install")
}

# --- 3. the WASM ----------------------------------------------------------
if (Missing "packages/ssplayer-core/wasm/ssruntime_bg.wasm", "packages/ssconverter-core/wasm/ssconverter_bg.wasm") {
    Write-Host ">> ${APP}: pnpm run download:wasm"
    & pnpm run download:wasm
    if ($LASTEXITCODE -ne 0) {
        if (-not ((Get-Command cargo -ErrorAction SilentlyContinue) -and (Get-Command wasm-pack -ErrorAction SilentlyContinue))) {
            Fail "there is no SDK release to download the WASM from yet, and building it needs Rust (https://rustup.rs) and wasm-pack (cargo install wasm-pack)"
        }
        Write-Host ">> ${APP}: no release to download from; building the WASM from source (pnpm run build:wasm)"
        Run pnpm @("run", "build:wasm")
    }
}

# --- 4. the packages ------------------------------------------------------
if (Missing "packages/ssplayer-core/dist/index.js", "packages/ssconverter-core/dist/index.js", "packages/ssplayer-webgl/dist/index.js", "packages/ssplayer-pixi/dist/index.js") {
    Write-Host ">> ${APP}: pnpm run build"
    Run pnpm @("run", "build")
}

# --- 5. the assets --------------------------------------------------------
if (Missing "examples/$DIR/public/Ringo/Ringo.ssab") {
    Write-Host ">> ${APP}: converting the SDK's test projects (pnpm run deploy-examples)"
    Run pnpm @("run", "deploy-examples")
}

# --- 6. the example -------------------------------------------------------
Write-Host ">> ${APP}: starting examples/$DIR (Ctrl-C to stop)"
& pnpm --filter "./examples/$DIR" run dev --open
exit $LASTEXITCODE

#!/usr/bin/env pwsh
#
# Install what the documentation site needs in order to build.
# PowerShell twin of prepare-docs.sh.
#
#   scripts/prepare-docs.ps1            # pnpm install + the prebuilt SDK wasm
#   scripts/prepare-docs.ps1 wasm=build # compile the wasm from Rust instead
#
# Two things, because a fresh checkout has neither:
#
#   1. node_modules, from the lockfile.
#   2. The SDK wasm. It is not tracked in git, and the packages' sources import
#      it -- TypeDoc parses those sources to generate docs/api, so the docs build
#      needs the wasm on disk even though the site itself never loads it.
#
# Documentation only, in the sense that this is all the docs need: the other
# scripts here build and release the player. The -docs suffix keeps the two
# apart.
#
# Then: scripts/build-docs.ps1, which runs TypeDoc and VitePress.
$ErrorActionPreference = "Stop"

$APP = Split-Path -Leaf $PSCommandPath
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# Plain stderr + an exit code, rather than Write-Error's stack trace:
# prepare-docs.sh answers the same mistakes the same way (2 = bad usage, 1 = the
# environment is not ready).
function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${APP}: $Message")
    exit $Code
}

# --- options --------------------------------------------------------------
$opts = [ordered]@{
    frozen = "yes"
    wasm   = "download"
}

function Show-Usage {
    Write-Host "Usage: $APP [options]"
    Write-Host "$APP options:"
    Write-Host "  frozen=<yes|no>         Install with --frozen-lockfile, i.e. fail rather than"
    Write-Host "                          update pnpm-lock.yaml (default: yes)"
    Write-Host "  wasm=<download|build|no>"
    Write-Host "                          Where the SDK wasm comes from (default: download)."
    Write-Host "                          download = the prebuilt binaries for SDK_VERSION.txt;"
    Write-Host "                          build    = compile the Rust core here, which needs"
    Write-Host "                                     rustup and wasm-pack;"
    Write-Host "                          no       = leave whatever is already on disk."
    Write-Host "  -h | --help             Show this help"
    Write-Host ""
    Write-Host "The wasm is not optional for a docs build: TypeDoc parses packages/*/src to"
    Write-Host "generate docs/api, and those sources import the wasm bindings."
    Write-Host ""
    Write-Host "Building the site is scripts/build-docs.ps1, not this script."
}

foreach ($item in $args) {
    if ($item -in "-h", "--help", "help") {
        Show-Usage
        exit 0
    } elseif ($item -match "=") {
        $key, $value = $item -split "=", 2
        if (-not $opts.Contains($key)) {
            Fail "unknown option '$key' (see $APP --help)" 2
        }
        # Both options are enums here, so both are case-folded.
        $opts[$key] = $value.ToLower()
    } else {
        Fail "unknown argument '$item' (options are key=value; see $APP --help)" 2
    }
}

if ($opts.frozen -notin "yes", "no") { Fail "frozen must be yes or no (got '$($opts.frozen)')" 2 }
if ($opts.wasm -notin "download", "build", "no") {
    Fail "wasm must be download, build or no (got '$($opts.wasm)')" 2
}

Write-Host "options"
Write-Host "  frozen => $($opts.frozen)"
Write-Host "  wasm   => $($opts.wasm)"
Write-Host ""

# --- preflight ------------------------------------------------------------
if (!(Test-Path (Join-Path $ROOT_DIR "docs/package.json"))) {
    Fail "docs/package.json not found -- is this the SSPlayerForWeb repo?"
}

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("${APP}: pnpm not found (this repo pins it in package.json's packageManager)")
    Fail "enable it with 'corepack enable', or install it from https://pnpm.io"
}

function Invoke-Checked {
    param([string] $What, [scriptblock] $Body)
    & $Body
    if ($LASTEXITCODE -ne 0) { Fail "$What failed ($LASTEXITCODE)" $LASTEXITCODE }
}

# Every workspace path is relative to the repo root, so run from there however
# the script was invoked.
Push-Location $ROOT_DIR
try {
    # --- install ----------------------------------------------------------
    if ($opts.frozen -eq "yes") {
        Write-Host ">> pnpm install --frozen-lockfile"
        Invoke-Checked "pnpm install" { & pnpm install --frozen-lockfile }
    } else {
        Write-Host ">> pnpm install"
        Invoke-Checked "pnpm install" { & pnpm install }
    }

    # --- wasm -------------------------------------------------------------
    switch ($opts.wasm) {
        "download" {
            $sdk = (Get-Content (Join-Path $ROOT_DIR "scripts/SDK_VERSION.txt") -Raw).Trim()
            Write-Host ""
            Write-Host ">> pnpm run download:wasm  (SDK $sdk)"
            Invoke-Checked "wasm download" { & pnpm run download:wasm }
        }
        "build" {
            Write-Host ""
            Write-Host ">> pnpm run build:wasm  (needs rustup + wasm-pack)"
            Invoke-Checked "wasm build" { & pnpm run build:wasm }
        }
        "no" {
            Write-Host ""
            Write-Host "${APP}: wasm=no -- using whatever is already under packages/*/wasm"
        }
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "${APP}: done"
Write-Host "${APP}: build the site:  scripts/build-docs.ps1"
Write-Host "${APP}: live preview:    pnpm --filter=docs run dev"

#!/usr/bin/env pwsh
#
# Build every ssab-schema version of ssconverter-web listed in
# packages/ssconverter-web/versions.json and stage them under
# <OUT>/ssconverter/<schema>/ for a GitHub Pages deploy.
# PowerShell twin of build-ssconverter-pages.sh.
#
# Strategy: rebuild-all. The artifact-based Pages deploy replaces the whole site
# on every run, so keeping past versions means rebuilding all of them each time.
# Each version's converter wasm is not tracked in git, so it is fetched on demand
# from the SpriteStudio-SDK Releases for that version's sdk tag in versions.json,
# or scripts/SDK_VERSION.txt's for the entry that names none.
#
# App source per version:
#   - No "ref" field  -> built from the current working tree (the common case;
#     fine while the wasm JS interface stays stable across schema versions).
#   - "ref" field set -> that version is built from the pinned git ref (tag /
#     branch / commit) in an isolated worktree, so a past version keeps building
#     against the app source it shipped with even if the wasm interface changes.
#     Requires full history in CI (actions/checkout with fetch-depth: 0).
#
# Usage:  $env:SITE_BASE = "/SSPlayerForWeb/"; scripts/build-ssconverter-pages.ps1 <out-dir>
#   SITE_BASE : Pages base path (with leading/trailing slash), e.g. /SSPlayerForWeb/
#   SDK_WASM  : download (default) | build. build reuses the converter wasm
#               already in the working tree for the one version whose sdk tag
#               matches scripts/SDK_VERSION.txt -- what `build-pages.ps1 sdk=build`
#               passes, and the way through while that SDK release does not exist
#               yet. Every other version is still downloaded: an older pinned
#               version's wasm is not what the submodule builds today.
#   <out-dir> : staging destination, e.g. _site
#
# Unlike the .sh twin this needs no jq -- ConvertFrom-Json reads the manifest.
$ErrorActionPreference = "Stop"
# Invoke-WebRequest's progress bar slows the download itself in Windows PowerShell 5.1.
$ProgressPreference = "SilentlyContinue"

$APP = Split-Path -Leaf $PSCommandPath
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${APP}: $Message")
    exit $Code
}

function Invoke-Checked {
    param([string] $What, [scriptblock] $Body)
    # Cleared first so a stale code from an earlier tolerated failure cannot be
    # read as this command's.
    $global:LASTEXITCODE = 0
    & $Body
    if ($LASTEXITCODE -ne 0) { Fail "$What failed ($LASTEXITCODE)" $LASTEXITCODE }
}

if ($args.Count -lt 1) { Fail "usage: $APP <out-dir>" 2 }
$OUT = $args[0]
if (-not [System.IO.Path]::IsPathRooted($OUT)) { $OUT = Join-Path (Get-Location).Path $OUT }
$OUT = [System.IO.Path]::GetFullPath($OUT)
if ([string]::IsNullOrWhiteSpace($env:SITE_BASE)) {
    Fail "SITE_BASE is required, e.g. /SSPlayerForWeb/" 2
}
$SITE_BASE = $env:SITE_BASE
$SDK_WASM = if ($env:SDK_WASM) { $env:SDK_WASM } else { "download" }
if ($SDK_WASM -notin "download", "build") {
    Fail "SDK_WASM must be download or build (got '$SDK_WASM')" 2
}

$MANIFEST = Join-Path $ROOT_DIR "packages/ssconverter-web/versions.json"
$REPO = "cri-middleware/SpriteStudio-SDK"
# The SDK publishes ONE combined web archive holding runtime-web/,
# runtime-web-nosimd/ and converter-web/ as subdirectories -- the same asset
# `download-sdk.ps1` consumes. There is no per-package zip; keep this name and
# the extraction below in step with that script.
$WEB_ASSET = "spritestudio-sdk-web-libs.zip"
# The version the working tree's own wasm is built from, for SDK_WASM=build.
$LOCAL_SDK = (Get-Content (Join-Path $ROOT_DIR "scripts/SDK_VERSION.txt")).Trim()

# Fetch a version's converter wasm into <src>/packages/ssconverter-core/wasm,
# replacing whatever was there (a previous iteration or `download:wasm`). The
# zip is verified against the release's SHA256SUMS manifest before extracting,
# so a corrupted or tampered download fails loudly.
function Get-VersionWasm {
    param([string] $Src, [string] $Sdk)

    $wasmDir = Join-Path $Src "packages/ssconverter-core/wasm"
    $localWasm = Join-Path $ROOT_DIR "packages/ssconverter-core/wasm"

    # SDK_WASM=build: this version pins the very tag the working tree's wasm was
    # built from, so use that instead of asking the Releases for it. Only the
    # current version qualifies -- an older pinned one wants the wasm it shipped
    # with, which is exactly what its sdk tag names.
    if ($SDK_WASM -eq "build" -and $Sdk -eq $LOCAL_SDK) {
        if (!(Test-Path (Join-Path $localWasm "ssconverter_bg.wasm"))) {
            [Console]::Error.WriteLine("${APP}: SDK_WASM=build, but packages/ssconverter-core/wasm holds no")
            [Console]::Error.WriteLine("${APP}: ssconverter_bg.wasm -- build it first ('pnpm run build:wasm', or")
            Fail "scripts/build-pages.ps1 sdk=build without skip=wasm)"
        }
        Write-Host "   using the working tree's converter wasm (SDK_WASM=build, sdk $Sdk)"
        # Already in place when building from the repo itself; a pinned-ref
        # worktree needs its own copy.
        if ($Src -ne $ROOT_DIR) {
            Remove-Item -Recurse -Force $wasmDir -ErrorAction SilentlyContinue
            New-Item -ItemType Directory -Force -Path $wasmDir | Out-Null
            Copy-Item -Path (Join-Path $localWasm "*") -Destination $wasmDir -Recurse -Force
        }
        return
    }
    if ($SDK_WASM -eq "build") {
        # Worth saying out loud: SDK_WASM=build covers one version, and the moment
        # versions.json carries a second one this line is where the other goes.
        Write-Host "   SDK_WASM=build does not cover $Sdk (the working tree builds $LOCAL_SDK)"
    }

    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
        $base = "https://github.com/$REPO/releases/download/$Sdk"
        Write-Host "   downloading $base/$WEB_ASSET"
        Invoke-WebRequest -Uri "$base/$WEB_ASSET" -OutFile "$tmp/web-libs.zip"
        Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile "$tmp/SHA256SUMS"

        $expected = $null
        foreach ($line in Get-Content "$tmp/SHA256SUMS") {
            $parts = $line -split '\s+', 2
            if ($parts.Count -eq 2 -and $parts[1].Trim() -eq $WEB_ASSET) {
                $expected = $parts[0].ToLower()
                break
            }
        }
        if (-not $expected) { Fail "no checksum entry for $WEB_ASSET in SHA256SUMS" }

        $actual = (Get-FileHash -Algorithm SHA256 -Path "$tmp/web-libs.zip").Hash.ToLower()
        if ($expected -ne $actual) {
            Fail "checksum mismatch for $WEB_ASSET (expected $expected, got $actual)"
        }
        Write-Host "   checksum OK: $WEB_ASSET"

        $extract = Join-Path $tmp "zip"
        # Expand-Archive is a script-module function: run from a session, it reads
        # the global progress preference rather than this script's.
        $savedProgress = $global:ProgressPreference
        $global:ProgressPreference = "SilentlyContinue"
        try {
            Expand-Archive -Path "$tmp/web-libs.zip" -DestinationPath $extract -Force
        } finally {
            $global:ProgressPreference = $savedProgress
        }
        # The files land flat, as @spritestudio/ssconverter-core expects (mirrors
        # download-sdk.ps1). A renamed or restructured archive aborts the build
        # instead of leaving an empty wasm dir behind -- what `unzip`'s exit code
        # buys the .sh twin.
        $converter = Join-Path $extract "converter-web"
        if (!(Test-Path $converter)) { Fail "converter-web/ not found in $WEB_ASSET" }

        Remove-Item -Recurse -Force $wasmDir -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $wasmDir | Out-Null
        Copy-Item -Path (Join-Path $converter "*") -Destination $wasmDir -Recurse -Force
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

# Build ssconverter-web from a source tree and stage the output.
function Build-Version {
    param([string] $Src, [string] $Schema, [string] $Sdk)

    Get-VersionWasm $Src $Sdk
    # Filtered by PATH, not by package name: $Src may be a worktree of an old `ref`
    # from versions.json, and a package name can be renamed between then and now
    # (ssconverter-web was) while its directory stays put.
    # ssconverter-web imports the engine from @spritestudio/ssconverter-core (its
    # dist + bundled wasm), so build the core against this version's wasm first.
    Invoke-Checked "ssconverter-core build ($Schema)" { & pnpm -C $Src --filter=./packages/ssconverter-core build }
    # Build with a per-version base so assets resolve under /<repo>/ssconverter/<schema>/.
    Invoke-Checked "ssconverter-web tsc ($Schema)" { & pnpm -C $Src --filter=./packages/ssconverter-web exec tsc }
    Invoke-Checked "ssconverter-web vite build ($Schema)" {
        & pnpm -C $Src --filter=./packages/ssconverter-web exec vite build --base="$($SITE_BASE)ssconverter/$Schema/"
    }

    $dest = Join-Path $OUT "ssconverter/$Schema"
    Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path (Join-Path $Src "packages/ssconverter-web/dist/*") -Destination $dest -Recurse -Force
}

# Not $manifest: PowerShell variable names are case-insensitive, so that one is
# $MANIFEST, the path this is read from.
$manifestData = Get-Content $MANIFEST -Raw | ConvertFrom-Json
$LATEST = $manifestData.latest

New-Item -ItemType Directory -Force -Path (Join-Path $OUT "ssconverter") | Out-Null
Copy-Item $MANIFEST (Join-Path $OUT "ssconverter/versions.json") -Force

try {
    foreach ($version in $manifestData.versions) {
        $schema = $version.schema
        $sdk = $version.sdk
        if (-not $sdk) { $sdk = $LOCAL_SDK }
        $ref = $version.ref

        if ($ref) {
            Write-Host "== ssconverter $schema  (SDK wasm: $sdk, source: $ref) =="
            # git worktree add requires a non-existent path.
            $wt = Join-Path (Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())) "wt"
            Invoke-Checked "git worktree add ($ref)" { & git -C $ROOT_DIR worktree add --detach $wt $ref }
            try {
                # Install the pinned ref's own deps so it builds with its era's toolchain.
                Invoke-Checked "pnpm install ($ref)" { & pnpm -C $wt install --frozen-lockfile }
                Build-Version $wt $schema $sdk
            } finally {
                & git -C $ROOT_DIR worktree remove --force $wt
            }
        } else {
            Write-Host "== ssconverter $schema  (SDK wasm: $sdk, source: working tree) =="
            Build-Version $ROOT_DIR $schema $sdk
        }
    }
} finally {
    # Prune any leftover worktrees (belt-and-suspenders; each is also removed
    # inline right after use). Its own failure must not mask whatever brought us
    # here, so it is swallowed.
    try { & git -C $ROOT_DIR worktree prune 2>$null } catch { }
    $global:LASTEXITCODE = 0
}

# Redirect bare /ssconverter/ to the latest schema version.
$redirect = @"
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./$LATEST/">
<link rel="canonical" href="./$LATEST/">
<title>SpriteStudio Converter Web</title>
<a href="./$LATEST/">SpriteStudio Converter Web ($LATEST)</a>
"@
Set-Content -Path (Join-Path $OUT "ssconverter/index.html") -Value $redirect -Encoding utf8

Write-Host "ssconverter versions staged under $OUT/ssconverter (latest: $LATEST)"

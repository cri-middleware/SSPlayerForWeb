#!/usr/bin/env pwsh
#
# Build the whole GitHub Pages site into one directory: the docs (VitePress) at
# the root, ssconverter-web (every schema version in versions.json) under
# /ssconverter/, and the examples -- pixi, webgl, override, the static RPG Maker
# MZ SampleProject (rmmz) and the static TyranoScript project -- under
# /examples/.
# PowerShell twin of build-pages.sh.
#
#   scripts/build-pages.ps1                            # -> _site, base /<repo>/
#   scripts/build-pages.ps1 base=/ out=C:\tmp\site     # a site served from a root
#   scripts/build-pages.ps1 sdk=build                  # compile the wasm instead
#   scripts/build-pages.ps1 skip=install,wasm,ssconverter api=no   # iterate fast
#
# pages.yml runs the .sh twin for the site it uploads, so CI and a local build
# cannot drift. The workflow keeps only what is GitHub's -- the checkout (SDK
# submodule + full history), the pnpm/Node toolchain, the artifact upload and
# the deploy; everything that produces a file lives here.
#
# The whole site is rebuilt every run, which is what the artifact deploy does
# anyway (it replaces the site wholesale, so past ssconverter versions only stay
# up by being rebuilt). skip= trades that away for speed while iterating.
#
# One run at a time per worktree, whichever twin: the stages write through
# packages/*/dist, packages/*/wasm and the example projects, so a second run
# deletes what the first is reading. It shows up as an unrelated-looking failure
# -- a sync:plugin that cannot find main.js, a wasm copy whose source vanished.
#
# What this needs that a plain `pnpm install` does not: the SpriteStudio-SDK
# submodule (deploy-examples compiles its tests/*.sspj, and sdk=build compiles
# its Rust runtime) and network access (the SDK wasm per converter version, and
# the TyranoScript engine). Unlike the .sh twin it needs no jq: the ssconverter
# step reads versions.json with ConvertFrom-Json.
$ErrorActionPreference = "Stop"

$APP = Split-Path -Leaf $PSCommandPath
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# Stages, in the order they run. `assemble` is not one of them: it is cheap and
# copies whatever the stages produced, so there is nothing to skip.
$STAGES = @("install", "wasm", "packages", "assets", "rmmz", "tyranoscript", "docs", "examples", "ssconverter")

function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${APP}: $Message")
    exit $Code
}

# Wraps both native commands and the sibling .ps1 scripts. A script called with
# `&` returns to its caller when it exits, rather than taking the caller with it,
# so its exit code has to be read back the same way a native command's is --
# cleared first, so a stale code from an earlier tolerated failure cannot be read
# as this command's.
function Invoke-Checked {
    param([string] $What, [scriptblock] $Body)
    $global:LASTEXITCODE = 0
    & $Body
    if ($LASTEXITCODE -ne 0) { Fail "$What failed ($LASTEXITCODE)" $LASTEXITCODE }
}

# Run a native command whose failure is not an error here (no origin remote, no
# git at all), returning its output or $null. PowerShell 7.4 turns a non-zero
# exit into a terminating error while $ErrorActionPreference is Stop, which is
# what the other calls in this script want and this one does not.
function Get-NativeOutput {
    param([scriptblock] $Body)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try { $out = & $Body 2>$null } catch { $out = $null }
    $ErrorActionPreference = $previous
    $global:LASTEXITCODE = 0
    return $out
}

# --- options --------------------------------------------------------------

# A project site is served under /<repo>/. The workflow passes
# github.event.repository.name; here the origin remote names the repository,
# falling back to the clone's directory name.
function Get-DefaultBase {
    $url = "" + (Get-NativeOutput { & git -C $ROOT_DIR config --get remote.origin.url })
    $name = ($url.Trim() -split "/")[-1] -replace "\.git$", ""
    if (-not $name) { $name = Split-Path -Leaf $ROOT_DIR }
    return "/$name/"
}

$opts = [ordered]@{
    base  = Get-DefaultBase
    out   = "_site"
    api   = "yes"
    sdk   = "download"
    skip  = ""
    clean = ""   # resolved after parsing: yes when nothing is skipped, no otherwise
}

function Show-Usage {
    Write-Host "Usage: $APP [options]"
    Write-Host "$APP options:"
    Write-Host "  base=<path>             Public base path (default: $($opts.base) -- this clone's"
    Write-Host "                          repository name, which is what a project site is"
    Write-Host "                          served under). Must start and end with '/'. base=/"
    Write-Host "                          builds a site you can serve from a document root."
    Write-Host "  out=<dir>               Where to assemble the site (default: $($opts.out))."
    Write-Host "                          Relative paths resolve against the current directory."
    Write-Host "  api=<yes|no>            Regenerate the API reference with TypeDoc (default:"
    Write-Host "                          $($opts.api)). api=no is passed straight to build-docs.ps1."
    Write-Host "  sdk=<download|build>    Where the SDK wasm comes from (default: $($opts.sdk))."
    Write-Host "                          download = download-sdk.ps1, the pre-built release"
    Write-Host "                          for scripts/SDK_VERSION.txt. build ="
    Write-Host "                          build-runtime.ps1, compiled from the Rust source in"
    Write-Host "                          the submodule (release mode; needs rustup +"
    Write-Host "                          wasm-pack) -- what to use when the SDK release the"
    Write-Host "                          version file names does not exist yet."
    Write-Host "  skip=<a,b,...>          Stages to leave out. One or more of:"
    Write-Host "                          $($STAGES -join ' ')"
    Write-Host "  clean=<yes|no>          Delete <out> before building (default: yes, or no"
    Write-Host "                          when skip= is given, so a partial run keeps the"
    Write-Host "                          pieces an earlier run produced)."
    Write-Host "  -h | --help             Show this help"
    Write-Host ""
    Write-Host "Stages:"
    Write-Host "  install       pnpm install --frozen-lockfile"
    Write-Host "  wasm          the SDK runtime + converter wasm (not in git), per sdk="
    Write-Host "  packages      pnpm run build (every package except docs)"
    Write-Host "  assets        deploy-examples -- compile the SDK test projects to .ssab"
    Write-Host "  rmmz          sync the built plugin + wasm into rmmz-example"
    Write-Host "  tyranoscript  fetch the TyranoScript engine, then sync the plugin + wasm"
    Write-Host "  docs          build-docs.ps1 (TypeDoc, then VitePress)"
    Write-Host "  examples      vite build for pixi-example, webgl-example, override-example"
    Write-Host "  ssconverter   build-ssconverter-pages.ps1 -- every schema version"
    Write-Host ""
    Write-Host "A skipped stage leaves its part out of the site (a warning says which);"
    Write-Host "a stage that ran but produced nothing is an error."
    Write-Host ""
    Write-Host "sdk=build reaches the ssconverter stage too, but only as far as one schema"
    Write-Host "version: the one whose sdk tag in versions.json matches SDK_VERSION.txt gets"
    Write-Host "the wasm just built, and every other version is still downloaded from the"
    Write-Host "release it pins -- which is the point of pinning it, and which no local build"
    Write-Host "can stand in for. Each version says out loud which of the two it took."
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
        # base= and out= are paths; the rest are keywords, so case-fold those.
        $opts[$key] = if ($key -in "base", "out") { $value } else { $value.ToLower() }
    } else {
        Fail "unknown argument '$item' (options are key=value; see $APP --help)" 2
    }
}

if ($opts.api -notin "yes", "no") { Fail "api must be yes or no (got '$($opts.api)')" 2 }
if ($opts.sdk -notin "download", "build") { Fail "sdk must be download or build (got '$($opts.sdk)')" 2 }

# A base that does not start and end with / silently produces a site whose every
# asset URL is wrong, and nothing downstream notices until it is deployed.
if ($opts.base -ne "/" -and $opts.base -notmatch '^/.*/$') {
    Fail "base must start and end with '/' (got '$($opts.base)')" 2
}

$SKIP = @($opts.skip -split "," | Where-Object { $_ -ne "" })
foreach ($name in $SKIP) {
    if ($name -notin $STAGES) {
        Fail "unknown stage '$name' in skip= (stages: $($STAGES -join ' '))" 2
    }
}

if (-not $opts.clean) { $opts.clean = if ($SKIP.Count -gt 0) { "no" } else { "yes" } }
if ($opts.clean -notin "yes", "no") { Fail "clean must be yes or no (got '$($opts.clean)')" 2 }

# Resolve out= against the invoking directory, before anything moves away from it.
$OUT = $opts.out
if (-not [System.IO.Path]::IsPathRooted($OUT)) { $OUT = Join-Path (Get-Location).Path $OUT }
$OUT = [System.IO.Path]::GetFullPath($OUT)
# clean=yes deletes this path, so refuse the two that would take the repository
# (or a whole drive) with them.
if ($OUT -eq [System.IO.Path]::GetPathRoot($OUT) -or $OUT -eq [System.IO.Path]::GetFullPath($ROOT_DIR)) {
    Fail "refusing to use '$OUT' as out= (it is deleted when clean=yes)" 2
}

function Test-Skipped {
    param([string] $Name)
    return $SKIP -contains $Name
}

# Enter-Stage <name> <what it does> -- $true when the stage should run.
function Enter-Stage {
    param([string] $Name, [string] $What)
    Write-Host ""
    if (Test-Skipped $Name) {
        Write-Host ">> [$Name] skipped"
        return $false
    }
    Write-Host ">> [$Name] $What"
    return $true
}

Write-Host "options"
Write-Host "  base  => $($opts.base)"
Write-Host "  out   => $OUT"
Write-Host "  api   => $($opts.api)"
Write-Host "  sdk   => $($opts.sdk)"
Write-Host "  skip  => $(if ($SKIP.Count) { $SKIP -join ' ' } else { '(nothing)' })"
Write-Host "  clean => $($opts.clean)"

# --- preflight ------------------------------------------------------------
if (!(Test-Path (Join-Path $ROOT_DIR "pnpm-workspace.yaml"))) {
    Fail "pnpm-workspace.yaml not found -- is this the SSPlayerForWeb repo?"
}

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("${APP}: pnpm not found (this repo pins it in package.json's packageManager)")
    Fail "enable it with 'corepack enable', or install it from https://pnpm.io"
}

# deploy-examples compiles SpriteStudio-SDK/tests/*.sspj, which only exist once
# the submodule is checked out. download:wasm is no substitute -- it brings the
# wasm, not the test projects.
if (!(Test-Skipped "assets") -and !(Test-Path (Join-Path $ROOT_DIR "SpriteStudio-SDK/tests"))) {
    [Console]::Error.WriteLine("${APP}: SpriteStudio-SDK/tests is missing -- the submodule is not checked out")
    Fail "fix it with 'git submodule update --init --recursive'"
}

# sdk=build compiles the Rust runtime in that same submodule. (wasm-pack itself
# is not checked for here: SpriteStudio-SDK/scripts/release-web.ps1 already does
# it, and it also accepts one that only lives in ~/.cargo/bin.)
if ($opts.sdk -eq "build" -and !(Test-Skipped "wasm") -and
    !(Test-Path (Join-Path $ROOT_DIR "SpriteStudio-SDK/libs/ssruntime"))) {
    [Console]::Error.WriteLine("${APP}: sdk=build needs SpriteStudio-SDK/libs/ssruntime -- the submodule is not checked out")
    Fail "fix it with 'git submodule update --init --recursive'"
}

# A version pinned to a git ref is built in a worktree, which a shallow clone
# cannot check out. CI passes fetch-depth: 0 for exactly this.
if (!(Test-Skipped "ssconverter")) {
    $manifest = Get-Content (Join-Path $ROOT_DIR "packages/ssconverter-web/versions.json") -Raw | ConvertFrom-Json
    if (@($manifest.versions | Where-Object { $_.ref }).Count -gt 0) {
        $shallow = "" + (Get-NativeOutput { & git -C $ROOT_DIR rev-parse --is-shallow-repository })
        if ($shallow.Trim() -eq "true") {
            [Console]::Error.WriteLine("${APP}: versions.json pins a version to a git ref, but this is a shallow clone")
            Fail "fix it with 'git fetch --unshallow --tags'"
        }
    }
}

# Every workspace path is relative to the repo root, so build from there however
# the script was invoked.
Push-Location $ROOT_DIR
try {
    # --- build ------------------------------------------------------------
    if ($opts.clean -eq "yes") {
        Remove-Item -Recurse -Force $OUT -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $OUT | Out-Null

    if (Enter-Stage "install" "install workspace dependencies") {
        Invoke-Checked "pnpm install" { & pnpm install --frozen-lockfile }
    }

    # wasm is not tracked in git, and the packages and the examples cannot be
    # built without it. sdk=download takes the pre-built release for the version
    # in scripts/SDK_VERSION.txt; sdk=build compiles it from the Rust source in
    # the submodule, in release mode -- a debug wasm has no business in a
    # published site, and this is the way out when the release the version file
    # names does not exist yet. Either way the runtime, its no-SIMD variant and
    # the converter all land in packages/*/wasm.
    #
    # (The ssconverter stage takes its converter wasm per schema version, from
    # the sdk tag versions.json pins. sdk=build reaches the one version whose tag
    # is the one built here; the rest still download.)
    $wasmWhat = if ($opts.sdk -eq "build") {
        "build the SDK wasm from source (runtime + converter, release)"
    } else {
        "download the SDK wasm (runtime + converter)"
    }
    if (Enter-Stage "wasm" $wasmWhat) {
        if ($opts.sdk -eq "build") {
            Invoke-Checked "build-runtime.ps1" { & (Join-Path $ROOT_DIR "scripts/build-runtime.ps1") "build=release" }
        } else {
            Invoke-Checked "download:wasm" { & pnpm run download:wasm }
        }
    }

    if (Enter-Stage "packages" "build the packages") {
        Invoke-Checked "packages build" { & pnpm run build }
    }

    # Generate the .ssab assets the examples load, from the SpriteStudio-SDK test
    # projects.
    if (Enter-Stage "assets" "generate the example assets") {
        Invoke-Checked "deploy-examples" { & pnpm run deploy-examples }
    }

    # rmmz-example is a static RPG Maker MZ project (no bundler): sync the built
    # plugin + no-SIMD runtime wasm into its js/plugins/. The assets stage already
    # produced the .ssab under SampleProject/spritestudio/.
    if (Enter-Stage "rmmz" "sync the rmmz-example plugin") {
        Invoke-Checked "rmmz sync:plugin" { & pnpm --filter rmmz-example run sync:plugin }
    }

    # tyranoscript-example is a static TyranoScript project. Fetch the (git-ignored)
    # engine -- index.html + tyrano/ + data/system/, pinned by TYRANO_VERSION.txt --
    # then sync the built plugin + runtime wasm into its plugin folder. The assets
    # stage already placed the Ringo .ssab under data/others/ssdata/.
    if (Enter-Stage "tyranoscript" "fetch the TyranoScript engine, sync the plugin") {
        Invoke-Checked "tyranoscript fetch:engine" { & pnpm --filter tyranoscript-example run fetch:engine }
        Invoke-Checked "tyranoscript sync:plugin" { & pnpm --filter tyranoscript-example run sync:plugin }
    }

    # docs (VitePress): build-docs.ps1 is what a contributor runs, so the docs
    # build stays spelled out in one place -- TypeDoc, then VitePress, with base
    # passed through as DOCS_BASE (config.mts reads it).
    #
    # Its companion scripts/prepare-docs.ps1 is deliberately not used: it is
    # `pnpm install` + `download:wasm`, which the stages above already ran for the
    # packages, the examples and the converter -- not for the docs alone.
    if (Enter-Stage "docs" "build the docs") {
        Invoke-Checked "build-docs.ps1" {
            & (Join-Path $ROOT_DIR "scripts/build-docs.ps1") "base=$($opts.base)" "api=$($opts.api)"
        }
    }

    # examples: base is injected via vite's --base CLI (the configs stay untouched).
    if (Enter-Stage "examples" "build the vite examples") {
        Invoke-Checked "pixi-example build" { & pnpm --filter=pixi-example exec vite build --base="$($opts.base)examples/pixi/" }
        Invoke-Checked "webgl-example build" { & pnpm --filter=webgl-example exec vite build --base="$($opts.base)examples/webgl/" }
        Invoke-Checked "override-example build" { & pnpm --filter=override-example exec vite build --base="$($opts.base)examples/override/" }
    }

    # ssconverter-web: every schema version from versions.json, into
    # <out>/ssconverter/<schema>/. It writes into <out> itself, so it runs before
    # assemble rather than through it.
    if (Enter-Stage "ssconverter" "build ssconverter-web (all schema versions)") {
        $env:SITE_BASE = $opts.base
        $env:SDK_WASM = $opts.sdk
        try {
            Invoke-Checked "build-ssconverter-pages.ps1" {
                & (Join-Path $ROOT_DIR "scripts/build-ssconverter-pages.ps1") $OUT
            }
        } finally {
            Remove-Item Env:SITE_BASE -ErrorAction SilentlyContinue
            Remove-Item Env:SDK_WASM -ErrorAction SilentlyContinue
        }
    }

    # --- assemble ---------------------------------------------------------
    Write-Host ""
    Write-Host ">> [assemble] collect the site into $OUT"

    # `cp -R <src>/. <dest>/` in PowerShell. Copy-Item cannot be used as it
    # stands for this: handed a directory whose name already exists under the
    # destination it copies *into* it (dest/assets/assets) rather than merging.
    function Copy-Merge {
        param([string] $Src, [string] $Dest)
        $srcFull = (Resolve-Path $Src).Path
        foreach ($file in Get-ChildItem -Path $srcFull -Recurse -Force -File) {
            $target = Join-Path $Dest $file.FullName.Substring($srcFull.Length).TrimStart('/', '\')
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $target -Force
        }
    }

    function Copy-Tree {
        param([string] $Label, [string] $Src, [string] $Dest, [bool] $Required)
        if (!(Test-Path $Src)) {
            if ($Required) { Fail "${Label}: $Src is missing though its stage ran" }
            Write-Host "   ${Label}: skipped (no $Src)"
            return
        }
        Remove-Item -Recurse -Force $Dest -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $Dest | Out-Null
        Copy-Item -Path (Join-Path $Src "*") -Destination $Dest -Recurse -Force
        Write-Host "   $Label -> $($Dest.Substring($OUT.Length).TrimStart('/', '\'))"
    }

    # The docs own the site root, so this one copy cannot wipe its destination --
    # ssconverter/ and examples/ live under it.
    if (Test-Path "docs/.vitepress/dist") {
        Copy-Merge "docs/.vitepress/dist" $OUT
        Write-Host "   docs -> (site root)"
    } elseif (Test-Skipped "docs") {
        Write-Host "   docs: skipped (no docs/.vitepress/dist)"
    } else {
        Fail "docs/.vitepress/dist is missing though the docs stage ran"
    }

    $req = !(Test-Skipped "examples")
    Copy-Tree "pixi-example"     "examples/pixi-example/dist"     (Join-Path $OUT "examples/pixi")     $req
    Copy-Tree "webgl-example"    "examples/webgl-example/dist"    (Join-Path $OUT "examples/webgl")    $req
    Copy-Tree "override-example" "examples/override-example/dist" (Join-Path $OUT "examples/override") $req

    # rmmz-example: the static MZ project is copied as it is -- its paths are
    # relative, so it runs under the /examples/rmmz/ subpath with no base rewrite.
    Copy-Tree "rmmz-example" "examples/rmmz-example/SampleProject" (Join-Path $OUT "examples/rmmz") $true

    # tyranoscript-example: engine + data, relative paths, likewise copied as it is.
    # Only the three paths the engine and the game need -- not scripts/ or the README.
    $TYRANO_SRC = "examples/tyranoscript-example"
    if ((Test-Path "$TYRANO_SRC/index.html") -and (Test-Path "$TYRANO_SRC/tyrano")) {
        $dest = Join-Path $OUT "examples/tyranoscript"
        Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $dest | Out-Null
        Copy-Item -Path "$TYRANO_SRC/index.html", "$TYRANO_SRC/tyrano", "$TYRANO_SRC/data" -Destination $dest -Recurse -Force
        Write-Host "   tyranoscript-example -> examples/tyranoscript"
    } elseif (Test-Skipped "tyranoscript") {
        Write-Host "   tyranoscript-example: skipped (engine not fetched)"
    } else {
        Fail "$TYRANO_SRC has no engine though the tyranoscript stage ran"
    }
} finally {
    Pop-Location
}

# --- done -----------------------------------------------------------------
Write-Host ""
Write-Host "${APP}: done -> $OUT  (base $($opts.base))"
if ($SKIP.Count -gt 0) {
    Write-Host "${APP}: partial site -- stages skipped: $($SKIP -join ' ')"
}
# --bind, and localhost in the URL, are not decoration: ssconverter-web reads
# the project folder through the File System Access API, which exists only in a
# secure context -- over plain http that means localhost / 127.0.0.1 / [::1] and
# nothing else. Served on the default bind, `python -m http.server` advertises
# itself as http://0.0.0.0:8080/ (or http://[::]:8080/), and a site opened at
# that URL cannot pick a folder at all.
if ($opts.base -eq "/") {
    Write-Host "${APP}: preview it:"
    Write-Host "  python -m http.server 8080 --bind 127.0.0.1 --directory `"$OUT`""
    Write-Host "  start http://localhost:8080/"
} else {
    # Every asset URL starts with base, so serving $OUT itself 404s. Hang it off
    # a scratch root under the base path instead -- a junction rather than a
    # symlink, because that one needs no elevation on Windows.
    $link = Join-Path ".pages-preview" (($opts.base.Trim("/")) -replace "/", [System.IO.Path]::DirectorySeparatorChar)
    Write-Host "${APP}: built for $($opts.base), so serving $OUT directly 404s on its assets."
    Write-Host "${APP}: preview it:"
    Write-Host "  New-Item -ItemType Directory -Force `"$(Split-Path -Parent $link)`" | Out-Null"
    Write-Host "  New-Item -ItemType Junction -Path `"$link`" -Target `"$OUT`" | Out-Null"
    Write-Host "  python -m http.server 8080 --bind 127.0.0.1 --directory .pages-preview"
    Write-Host "  start http://localhost:8080$($opts.base)"
    Write-Host "${APP}: open it as localhost, not as the http://[::]:8080/ the server prints:"
    Write-Host "${APP}: ssconverter-web needs a secure context to read a project folder."
}

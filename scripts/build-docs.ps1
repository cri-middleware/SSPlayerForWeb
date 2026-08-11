#!/usr/bin/env pwsh
#
# Build the documentation site: TypeDoc, then VitePress.
# PowerShell twin of build-docs.sh.
#
#   scripts/build-docs.ps1                       # -> docs/.vitepress/dist
#   scripts/build-docs.ps1 api=no                # skip TypeDoc; prose changes only
#   scripts/build-docs.ps1 base=/SSPlayerForWeb/ # what pages.yml passes
#
# Three things worth knowing, all of which differ from the sibling repositories:
#
#   1. One build, both locales. VitePress resolves `docs/ja` through its own i18n
#      support, so there is no locale option here and no order to get right --
#      the Zensical siblings need one build per locale precisely because they
#      have neither.
#   2. Dead links fail the build. VitePress checks them by default and the config
#      does not set `ignoreDeadLinks`, so this is the equivalent of the siblings'
#      --strict. Nothing builds the docs on a pull request (pages.yml runs on a
#      published release and on dispatch), so this run is the only gate.
#   3. `base` is env-driven. docs/.vitepress/config.mts reads DOCS_BASE and falls
#      back to '/', because a project site is served under /<repo>/ while local
#      builds are served from the root. Pass base= rather than setting it.
#
# What this does NOT build: the packages, the examples, and ssconverter-web. The
# root `pnpm run docs` builds the packages first, but the site does not consume
# them -- TypeDoc reads packages/*/src, not their dist -- and the examples and
# converter are separate outputs that pages.yml assembles around this one.
#
# `vitepress dev` and `vitepress preview` are deliberately not wrapped: they
# validate nothing and are foreground processes with no arguments worth
# defaulting. `pnpm --filter=docs run dev`, `... run preview`.
$ErrorActionPreference = "Stop"

$APP = Split-Path -Leaf $PSCommandPath
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${APP}: $Message")
    exit $Code
}

# --- options --------------------------------------------------------------
$opts = [ordered]@{
    api  = "yes"
    base = "/"
}

function Show-Usage {
    Write-Host "Usage: $APP [options]"
    Write-Host "$APP options:"
    Write-Host "  api=<yes|no>            Regenerate the API reference with TypeDoc first"
    Write-Host "                          (default: yes). api=no builds the prose and whatever"
    Write-Host "                          docs/api already holds -- much faster, and enough when"
    Write-Host "                          nothing under packages/*/src has changed."
    Write-Host "  base=<path>             Public base path, as DOCS_BASE (default: /)."
    Write-Host "                          A GitHub project site needs base=/<repo>/; leave it"
    Write-Host "                          alone for a build you will preview locally."
    Write-Host "  -h | --help             Show this help"
    Write-Host ""
    Write-Host "Output: docs/.vitepress/dist -- one build, both locales (VitePress resolves"
    Write-Host "docs/ja itself). A dead link fails the build, which is the only gate there is:"
    Write-Host "nothing builds the docs on a pull request."
    Write-Host ""
    Write-Host "Install the toolchain first with scripts/prepare-docs.ps1."
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
        # Only the yes/no flag is case-folded; base= is a path.
        $opts[$key] = if ($key -eq "api") { $value.ToLower() } else { $value }
    } else {
        Fail "unknown argument '$item' (options are key=value; see $APP --help)" 2
    }
}

if ($opts.api -notin "yes", "no") { Fail "api must be yes or no (got '$($opts.api)')" 2 }

# A base that does not start and end with / silently produces a site whose every
# asset URL is wrong, and nothing downstream notices until it is deployed.
if ($opts.base -ne "/" -and $opts.base -notmatch '^/.*/$') {
    Fail "base must start and end with '/' (got '$($opts.base)')" 2
}

Write-Host "options"
Write-Host "  api  => $($opts.api)"
Write-Host "  base => $($opts.base)"
Write-Host ""

# --- preflight ------------------------------------------------------------
if (!(Test-Path (Join-Path $ROOT_DIR "docs/package.json"))) {
    Fail "docs/package.json not found -- is this the SSPlayerForWeb repo?"
}

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("${APP}: pnpm not found (this repo pins it in package.json's packageManager)")
    Fail "enable it with 'corepack enable', or install it from https://pnpm.io"
}

if (!(Test-Path (Join-Path $ROOT_DIR "docs/node_modules"))) {
    Fail "docs/node_modules is missing -- run 'scripts/prepare-docs.ps1' first"
}

function Invoke-Checked {
    param([string] $What, [scriptblock] $Body)
    & $Body
    if ($LASTEXITCODE -ne 0) { Fail "$What failed ($LASTEXITCODE)" $LASTEXITCODE }
}

# Every workspace path is relative to the repo root, so build from there however
# the script was invoked.
Push-Location $ROOT_DIR
try {
    # --- build ------------------------------------------------------------
    $env:DOCS_BASE = $opts.base

    if ($opts.api -eq "yes") {
        Write-Host ">> pnpm --filter=docs run build  (typedoc, then vitepress)"
        Invoke-Checked "docs build" { & pnpm --filter=docs run build }
    } else {
        Write-Host ">> pnpm --filter=docs exec vitepress build  (api=no: docs/api left as it is)"
        Invoke-Checked "docs build" { & pnpm --filter=docs exec vitepress build }
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "${APP}: done -> docs/.vitepress/dist  (base $($opts.base))"
if ($opts.base -eq "/") {
    Write-Host "${APP}: preview it: pnpm --filter=docs run preview"
} else {
    Write-Host "${APP}: built for $($opts.base), so 'pnpm --filter=docs run preview' will 404 on"
    Write-Host "${APP}: its assets unless it is served from that path."
}

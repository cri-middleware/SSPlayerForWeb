#!/usr/bin/env pwsh
#
# Build every release artifact locally -- and publish none of them: the npm
# tarballs of the public packages and the plugin archives that go out as GitHub
# Releases, side by side in one directory with SHA256SUMS over the lot.
# PowerShell twin of build-release.sh.
#
#   scripts/build-release.ps1                          # everything
#   scripts/build-release.ps1 skip=install,wasm,test   # iterate
#   scripts/build-release.ps1 sdk=build                # compile the wasm instead
#   scripts/build-release.ps1 out=C:\tmp\rel           # somewhere else
#
# A release here is two channels, so both are built (see release.yml):
#
#   npm       The PUBLIC packages. `pnpm pack` is the same packing path
#             `pnpm publish` takes -- the `files` allow-list, the `prepack`
#             artifact guard, `workspace:^` rewritten to a real range -- so what
#             lands here is the file release.yml uploads.
#
#   plugins   The PRIVATE packages, which are never on npm. Each one's own
#             `pack` script produces exactly the file release.yml attaches to
#             the Release it cuts.
#
# release.yml runs the .sh twin for everything it uploads, so CI and a local run
# cannot drift: the tarballs it publishes to npm and the archives it attaches to
# the Releases are the files built and checked here, the same way. The workflow
# keeps what is GitHub's and npm's -- the checkout, the version commit, the
# publish, the tags and the Releases -- and reads <out>/manifest.json for which
# file is which. Run locally before a release, this is the one look at an npm
# tarball anyone gets while it can still be fixed: a published version is
# immutable.
#
# The versions are the working tree's, and this does not touch them. A release
# sets them first (scripts/set-versions.mjs), so a run without that step builds
# under the versions the tree has now. Setting them here would leave the
# release's own decision half-made in the working tree -- and it is a decision
# this script has no business making.
#
# The checks are the ones that would otherwise ship:
#
#   A `workspace:` range left in a published manifest. Nothing in the workspace
#   notices -- it resolves locally -- and an installed copy is unbuildable.
#
#   dist/ or wasm/ missing from a tarball. They are gitignored build outputs
#   that the `files` allow-list ships, so a pack that skipped the build uploads
#   those paths simply absent and npm takes it. That is what each package's
#   `prepack` guard is for; here it is re-checked from inside the finished
#   tarball, which is the only place it can be seen the way a consumer sees it.
#
#   The RPG Maker MZ plugin carrying the SIMD runtime. MZ runs on NW.js, whose
#   bundled Chromium predates wasm simd128: the plugin installs, loads, and then
#   dies on the wasm, in a way nothing in this repo would reproduce.
#
#   ssplayer.tbp renamed. TyranoBuilder derives the plugin id from the filename
#   and then reads <id>/<id>.builder.js out of the archive it just extracted, so
#   a version in the name installs nothing at all.
#
# The pack scripts write their zips with fflate, so the plugins stage needs no
# `zip`, which Windows does not ship. Reading the archives back goes through
# .NET and `tar` rather than `unzip`; Windows 10 1803 and later ship both.
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$APP = Split-Path -Leaf $PSCommandPath
$ROOT_DIR = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# Stages, in the order they run. Neither the checksums nor the verification are
# stages: they are cheap and they read whatever the stages produced.
$STAGES = @("install", "wasm", "build", "test", "npm", "plugins")

# The plugin channel, one row per Release asset (%v = version). The only place
# these names live -- release.yml takes them out of the manifest this run writes
# -- and the drift guard below refuses to run at all when a private package
# grows a `pack` script without a row here, which would otherwise read as a
# release with one plugin missing.
$PLUGIN_ROWS = @(
    @{ Package = "@spritestudio/ssplayer-rmmz";         Pattern = "dist/pack/ssplayer-rmmz-plugin-%v.zip" }
    @{ Package = "@spritestudio/ssplayer-tyranoscript"; Pattern = "dist/pack/ssplayer-tyranoscript-plugin-%v.zip" }
    @{ Package = "@spritestudio/ssplayer-tyranobuilder"; Pattern = "dist/pack/ssplayer.tbp" }
)

function Fail {
    param([string] $Message, [int] $Code = 1)
    [Console]::Error.WriteLine("${APP}: $Message")
    exit $Code
}

# Wraps native commands. A non-zero exit is fatal here, the way `set -e` makes
# it in the .sh twin -- cleared first, so a stale code from an earlier tolerated
# failure cannot be read as this command's.
function Invoke-Checked {
    param([string] $What, [scriptblock] $Body)
    $global:LASTEXITCODE = 0
    & $Body
    if ($LASTEXITCODE -ne 0) { Fail "$What failed ($LASTEXITCODE)" $LASTEXITCODE }
}

# Run a native command whose non-zero exit is a finding rather than an abort,
# and return that exit code. PowerShell 7.4 turns a non-zero exit into a
# terminating error while $ErrorActionPreference is Stop, which is what every
# other call here wants and this one does not.
function Invoke-Tolerant {
    param([scriptblock] $Body)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $global:LASTEXITCODE = 0
    try { & $Body 2>$null | Out-Null } catch { }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous
    $global:LASTEXITCODE = 0
    return $code
}

# --- reading the finished archives ----------------------------------------
# Through .NET rather than through `unzip`, which Windows does not ship.

function Get-ZipEntries {
    param([string] $Path)
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try { return @($zip.Entries | ForEach-Object { $_.FullName }) } finally { $zip.Dispose() }
}

function Get-ZipEntryHash {
    param([string] $Path, [string] $Entry)
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $e = $zip.GetEntry($Entry)
        if (-not $e) { return $null }
        $stream = $e.Open()
        try {
            $sha = [System.Security.Cryptography.SHA256]::Create()
            return ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace "-", "").ToLower()
        } finally { $stream.Dispose() }
    } finally { $zip.Dispose() }
}

function Get-ZipEntryText {
    param([string] $Path, [string] $Entry)
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $e = $zip.GetEntry($Entry)
        if (-not $e) { return $null }
        $stream = $e.Open()
        try {
            $reader = [System.IO.StreamReader]::new($stream)
            try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
        } finally { $stream.Dispose() }
    } finally { $zip.Dispose() }
}

function Get-FileSha256 {
    param([string] $Path)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLower()
}

# --- options --------------------------------------------------------------

$opts = [ordered]@{
    out    = "release-dist"
    sdk    = "download"
    skip   = ""
    verify = "yes"
    clean  = ""   # resolved after parsing: yes when nothing is skipped, no otherwise
}

function Show-Usage {
    Write-Host "Usage: $APP [options]"
    Write-Host "$APP options:"
    Write-Host "  out=<dir>               Where the artifacts and SHA256SUMS land (default:"
    Write-Host "                          $($opts.out)). Relative paths resolve against the"
    Write-Host "                          current directory."
    Write-Host "  sdk=<download|build|skip>"
    Write-Host "                          Where the SDK wasm comes from (default: $($opts.sdk))."
    Write-Host "                          download = download-sdk.ps1, the pre-built release for"
    Write-Host "                          scripts/SDK_VERSION.txt (what the release workflow"
    Write-Host "                          uses). build = build-runtime.ps1, compiled from the"
    Write-Host "                          Rust source in the submodule (release mode; needs"
    Write-Host "                          rustup + wasm-pack) -- the way through when that SDK"
    Write-Host "                          release does not exist yet. skip = keep"
    Write-Host "                          packages/*/wasm as it stands."
    Write-Host "  skip=<a,b,...>          Stages to leave out. One or more of:"
    Write-Host "                          $($STAGES -join ' ')"
    Write-Host "  verify=<yes|no>         Re-open the finished artifacts and check them"
    Write-Host "                          (default: $($opts.verify))."
    Write-Host "  clean=<yes|no>          Delete <out> before building (default: yes, or no"
    Write-Host "                          when skip= is given, so a partial run keeps what an"
    Write-Host "                          earlier one produced)."
        Write-Host "  in=                     Accepted and ignored here. The family's build-release"
    Write-Host "                          scripts share out= clean= verify= in= sdk= skip=,"
    Write-Host "                          so one command line drives all of them."
Write-Host "  -h | --help             Show this help"
    Write-Host ""
    Write-Host "Stages:"
    Write-Host "  install   pnpm install --frozen-lockfile"
    Write-Host "  wasm      the SDK runtime + converter wasm (not in git), per sdk="
    Write-Host "  build     pnpm run build (every package except docs)"
    Write-Host "  test      pnpm run test -- the gate the release runs before it publishes"
    Write-Host "  npm       pnpm pack for each public package -> <out>/npm"
    Write-Host "  plugins   each private package's pack script -> <out>/plugins"
    Write-Host ""
    Write-Host "Output: <out>/npm/*.tgz (the npm channel), <out>/plugins/* (the GitHub"
    Write-Host "Releases channel), <out>/manifest.json naming both (release.yml reads it to"
    Write-Host "publish the tarballs and cut the Releases) and SHA256SUMS over the lot."
    Write-Host ""
    Write-Host "This builds a release; it does not make one. Nothing here publishes, tags,"
    Write-Host "commits, or sets a version: the artifacts carry the versions the working"
    Write-Host "tree has right now, which a release sets first (scripts/set-versions.mjs)."
}

foreach ($item in $args) {
    if ($item -in "-h", "--help", "help") {
        Show-Usage
        exit 0
    } elseif ($item -match "=") {
        $key, $value = $item -split "=", 2
        # Accepted so one command line drives build-release in every repository
        # of the family; this one has no use for it.
        if ($key -eq "in") {
            [Console]::Error.WriteLine("${APP}: in= does not apply here; ignored")
            continue
        }
        if (-not $opts.Contains($key)) {
            Fail "unknown option '$key' (see $APP --help)" 2
        }
        # out= is a path; the rest are keywords, so case-fold those.
        $opts[$key] = if ($key -eq "out") { $value } else { $value.ToLower() }
    } else {
        Fail "unknown argument '$item' (options are key=value; see $APP --help)" 2
    }
}

if ($opts.sdk -notin "download", "build", "skip") { Fail "sdk must be download, build or skip (got '$($opts.sdk)')" 2 }
if ($opts.verify -notin "yes", "no") { Fail "verify must be yes or no (got '$($opts.verify)')" 2 }

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

$FAILED = [System.Collections.Generic.List[string]]::new()
function Add-Failure {
    param([string] $Message)
    $FAILED.Add($Message)
}

Write-Host "options"
Write-Host "  out    => $OUT"
Write-Host "  sdk    => $($opts.sdk)"
Write-Host "  skip   => $(if ($SKIP.Count) { $SKIP -join ' ' } else { '(nothing)' })"
Write-Host "  verify => $($opts.verify)"
Write-Host "  clean  => $($opts.clean)"

# --- preflight ------------------------------------------------------------

if (!(Test-Path (Join-Path $ROOT_DIR "pnpm-workspace.yaml"))) {
    Fail "pnpm-workspace.yaml not found -- is this the SSPlayerForWeb repo?"
}

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("${APP}: pnpm not found (this repo pins it in package.json's packageManager)")
    Fail "enable it with 'corepack enable', or install it from https://pnpm.io"
}

# `tar` reads the npm tarballs back (Windows 10 1803 and later ship bsdtar).
if (!(Get-Command tar -ErrorAction SilentlyContinue)) {
    Fail "tar not found -- it is what re-opens the npm tarballs"
}

# sdk=build compiles the Rust runtime in the submodule. (wasm-pack itself is not
# checked for here: SpriteStudio-SDK/scripts/release-web.ps1 already does it, and
# it also accepts one that only lives in ~/.cargo/bin.)
if ($opts.sdk -eq "build" -and !(Test-Skipped "wasm") -and
    !(Test-Path (Join-Path $ROOT_DIR "SpriteStudio-SDK/libs/ssruntime"))) {
    [Console]::Error.WriteLine("${APP}: sdk=build needs SpriteStudio-SDK/libs/ssruntime -- the submodule is not checked out")
    Fail "fix it with 'git submodule update --init --recursive'"
}

# --- what is in this release ----------------------------------------------
#
# The channel a package goes out on is a property of the package, not a list
# kept here: `private: true` is exactly what keeps it off npm, and it is what
# release.yml splits on too.
$PUBLIC_PKGS = [System.Collections.Generic.List[object]]::new()
$PLUGIN_PKGS = [System.Collections.Generic.List[object]]::new()
$NEITHER = [System.Collections.Generic.List[object]]::new()

foreach ($dir in (Get-ChildItem (Join-Path $ROOT_DIR "packages") -Directory | Sort-Object Name)) {
    $manifestPath = Join-Path $dir.FullName "package.json"
    if (!(Test-Path $manifestPath)) { continue }
    $m = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $entry = [pscustomobject]@{
        Dir      = $dir.Name
        Name     = $m.name
        Version  = $m.version
        Files    = @($m.files)
        Artifact = $null
    }
    if (-not $m.private) {
        $PUBLIC_PKGS.Add($entry)
    } elseif ($m.scripts -and $m.scripts.pack) {
        $row = $PLUGIN_ROWS | Where-Object { $_.Package -eq $m.name } | Select-Object -First 1
        if (-not $row) {
            [Console]::Error.WriteLine("${APP}: $($m.name) is private and has a pack script, but no row in PLUGIN_ROWS")
            Fail "add one -- release.yml reads the manifest, so it needs no change"
        }
        $entry.Artifact = $row.Pattern -replace "%v", $m.version
        $PLUGIN_PKGS.Add($entry)
    } else {
        $NEITHER.Add($entry)
    }
}

Write-Host ""
Write-Host "packages"
foreach ($p in $PUBLIC_PKGS) { Write-Host ("  npm      {0,-40} {1}" -f $p.Name, $p.Version) }
foreach ($p in $PLUGIN_PKGS) { Write-Host ("  release  {0,-40} {1}  ({2})" -f $p.Name, $p.Version, (Split-Path -Leaf $p.Artifact)) }
foreach ($p in $NEITHER)     { Write-Host ("  --       {0,-40} {1}  (private, no pack script -- not a release artifact)" -f $p.Name, $p.Version) }

# Every workspace path is relative to the repo root, so build from there however
# the script was invoked.
Push-Location $ROOT_DIR
try {
    if ($opts.clean -eq "yes") {
        Remove-Item -Recurse -Force $OUT -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $OUT | Out-Null

    # --- install ----------------------------------------------------------
    if (Enter-Stage "install" "pnpm install --frozen-lockfile") {
        Invoke-Checked "pnpm install" { & pnpm install --frozen-lockfile }
    }

    # --- the wasm ---------------------------------------------------------
    #
    # Not in git, and shipped inside two of the tarballs and all three plugin
    # archives. sdk=download takes the pre-built release for
    # scripts/SDK_VERSION.txt -- what release.yml does; sdk=build compiles it
    # from the submodule in release mode, which is the way through when that SDK
    # release does not exist yet.
    $wasmWhat = switch ($opts.sdk) {
        "download" { "download the SDK wasm (runtime, no-SIMD runtime, converter)" }
        "build"    { "build the SDK wasm from source (release mode)" }
        "skip"     { "keep packages/*/wasm as it stands" }
    }
    if (Enter-Stage "wasm" $wasmWhat) {
        switch ($opts.sdk) {
            "download" { Invoke-Checked "download:wasm" { & pnpm run download:wasm } }
            "build"    { Invoke-Checked "build-runtime.ps1" { & (Join-Path $ROOT_DIR "scripts/build-runtime.ps1") "build=release" } }
            "skip"     { Write-Host "   sdk=skip" }
        }
    }

    # Whatever brought it, it has to be there: ssplayer-core ships wasm/ in its
    # tarball, and the RPG Maker MZ plugin needs the no-SIMD variant specifically.
    foreach ($w in @(
        "packages/ssplayer-core/wasm/ssruntime_bg.wasm",
        "packages/ssplayer-core/wasm-nosimd/ssruntime_bg.wasm",
        "packages/ssconverter-core/wasm/ssconverter_bg.wasm")) {
        if (!(Test-Path (Join-Path $ROOT_DIR $w))) {
            [Console]::Error.WriteLine("${APP}: $w is missing -- the SDK wasm is not installed")
            Fail "run 'pnpm run download:wasm', or pass sdk=download / sdk=build"
        }
    }

    # --- build ------------------------------------------------------------
    if (Enter-Stage "build" "build the packages") {
        Invoke-Checked "packages build" { & pnpm run build }
    }

    # --- test -------------------------------------------------------------
    # The release runs this before it versions anything, because an npm version
    # is immutable once published. A rehearsal that skipped it would rehearse
    # the wrong thing.
    if (Enter-Stage "test" "pnpm run test") {
        Invoke-Checked "tests" { & pnpm run test }
    }

    # --- the npm channel --------------------------------------------------
    if (Enter-Stage "npm" "pack the public packages") {
        $npmOut = Join-Path $OUT "npm"
        New-Item -ItemType Directory -Force -Path $npmOut | Out-Null
        foreach ($p in $PUBLIC_PKGS) {
            $pkgName = $p.Name
            # `prepack` (verify-publish-artifacts.mjs) runs as part of this and
            # refuses a package whose advertised dist/wasm is not on disk.
            Invoke-Checked "pack $pkgName" { & pnpm --filter $pkgName pack --pack-destination $npmOut | Out-Null }
            # npm's tarball name: the scope's @ dropped, its / turned into a dash.
            $tgz = ($p.Name -replace "^@", "" -replace "/", "-") + "-$($p.Version).tgz"
            if (!(Test-Path (Join-Path $npmOut $tgz))) {
                Fail "pnpm pack did not produce $tgz"
            }
            Write-Host "   npm/$tgz"
        }
    }

    # --- the GitHub Releases channel --------------------------------------
    if (Enter-Stage "plugins" "pack the private plugins") {
        $pluginOut = Join-Path $OUT "plugins"
        New-Item -ItemType Directory -Force -Path $pluginOut | Out-Null
        foreach ($p in $PLUGIN_PKGS) {
            $pkgName = $p.Name
            Invoke-Checked "pack $pkgName" { & pnpm --filter $pkgName run pack | Out-Null }
            $src = Join-Path $ROOT_DIR "packages/$($p.Dir)/$($p.Artifact)"
            if (!(Test-Path $src)) {
                Fail "$($p.Name)'s pack script did not produce $($p.Artifact)"
            }
            Copy-Item $src $pluginOut -Force
            Write-Host "   plugins/$(Split-Path -Leaf $p.Artifact)"
        }
    }

    # --- the manifest -----------------------------------------------------
    # What this run produced, per channel, as data rather than as a listing to
    # be read. release.yml publishes each `.npm[]` tarball and tags and drafts a
    # Release for every entry as `<dir>-v<version>`, which is what keeps the
    # artifact names in exactly one place -- the PLUGIN_ROWS table above -- so
    # adding a package needs no change to the workflow.
    #
    # It lists what is on disk, not what this run was asked to build, so a
    # channel whose stage was skipped comes out empty and the workflow can say
    # so.
    Write-Host ""
    Write-Host ">> [manifest] writing manifest.json"
    $npmRows = @()
    foreach ($p in $PUBLIC_PKGS) {
        $tgz = ($p.Name -replace "^@", "" -replace "/", "-") + "-$($p.Version).tgz"
        if (Test-Path (Join-Path $OUT "npm/$tgz")) {
            $npmRows += [ordered]@{ package = $p.Name; dir = $p.Dir; version = $p.Version; file = "npm/$tgz" }
        }
    }
    $pluginRows = @()
    foreach ($p in $PLUGIN_PKGS) {
        $base = Split-Path -Leaf $p.Artifact
        if (Test-Path (Join-Path $OUT "plugins/$base")) {
            $pluginRows += [ordered]@{ package = $p.Name; dir = $p.Dir; version = $p.Version; file = "plugins/$base" }
        }
    }
    $manifest = [ordered]@{ npm = @($npmRows); plugins = @($pluginRows) }
    # LF endings, so both twins write the same bytes.
    $json = ($manifest | ConvertTo-Json -Depth 5) -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText((Join-Path $OUT "manifest.json"), $json.TrimEnd() + "`n")
    Write-Host "   npm: $($npmRows.Count), plugins: $($pluginRows.Count)"

    # --- checksums --------------------------------------------------------
    # Over whatever is in <out>, not over what this run produced: with clean=no a
    # partial run leaves an earlier run's artifacts in place, and a SHA256SUMS
    # that covered only half of them would be worse than none.
    $relative = @(Get-ChildItem $OUT -Recurse -File |
        Where-Object { $_.Name -ne "SHA256SUMS" } |
        ForEach-Object { $_.FullName.Substring($OUT.Length + 1) -replace "\\", "/" })
    $sorted = [string[]] $relative
    [Array]::Sort($sorted, [StringComparer]::Ordinal)

    Write-Host ""
    if ($sorted.Count -eq 0) {
        Write-Host ">> [checksums] nothing in $OUT to sum"
        Write-Host ""
        Fail "every stage that produces a file was skipped -- nothing was built."
    }
    Write-Host ">> [checksums] writing SHA256SUMS"
    # sha256sum's own format, with LF endings, so the file is the one the .sh
    # twin writes and `sha256sum -c` takes it on any host.
    $lines = foreach ($rel in $sorted) { "$(Get-FileSha256 (Join-Path $OUT $rel))  $rel" }
    [System.IO.File]::WriteAllText((Join-Path $OUT "SHA256SUMS"), ($lines -join "`n") + "`n")
    Write-Host "   $($sorted.Count) artifacts"

    # --- verify -----------------------------------------------------------
    if ($opts.verify -eq "yes") {
        Write-Host ""
        Write-Host ">> [verify] re-opening $OUT"

        $npmOut = Join-Path $OUT "npm"
        $pluginOut = Join-Path $OUT "plugins"

        # -- the npm tarballs --
        # Checked once the channel has been built at least once (an absent npm/
        # just means the stage never ran), and keyed on the name each package
        # would be published under.
        if (@(Get-ChildItem $npmOut -File -ErrorAction SilentlyContinue).Count -gt 0) {
            foreach ($p in $PUBLIC_PKGS) {
                $tgzName = ($p.Name -replace "^@", "" -replace "/", "-") + "-$($p.Version).tgz"
                $tgz = Join-Path $npmOut $tgzName
                if (!(Test-Path $tgz)) {
                    Add-Failure "$tgzName is missing from the npm channel"
                    continue
                }

                $entries = @(& tar -tzf $tgz)
                $manifest = (& tar -xzOf $tgz "package/package.json") -join "`n"
                $packed = $manifest | ConvertFrom-Json

                # The name and version inside are the ones this is filed under.
                # Catches a tarball built from a tree edited after the name was
                # computed, and a stale one left behind by an earlier run.
                if ($packed.name -ne $p.Name) { Add-Failure "$tgzName contains name $($packed.name), expected $($p.Name)" }
                if ($packed.version -ne $p.Version) { Add-Failure "$tgzName contains version $($packed.version), expected $($p.Version)" }

                # `private: true` would be refused by the registry, but by then
                # the run has already published everything alphabetically before it.
                if ($packed.private -eq $true) { Add-Failure "$tgzName is marked private -- it cannot go to npm" }

                # A workspace: range resolves inside this repo and nowhere else.
                if ($manifest -match "workspace:") { Add-Failure "$tgzName still has a workspace: range in its dependencies" }

                # Everything the `files` allow-list promises is actually inside.
                # dist/ and wasm/ are gitignored build outputs, so this is where
                # a pack that ran without a build shows up.
                foreach ($f in $p.Files) {
                    if (-not $f) { continue }
                    if (-not ($entries | Where-Object { $_ -like "package/$f*" })) {
                        Add-Failure "$tgzName is missing '$f' (it is in the files allow-list)"
                    }
                    # wasm/ is only worth shipping if the binary is in it.
                    if ($f -eq "wasm" -and -not ($entries | Where-Object { $_ -like "package/wasm/*.wasm" })) {
                        Add-Failure "$tgzName has a wasm/ directory with no .wasm in it"
                    }
                }

                # ssplayer-core ships the runtime binary TWICE on purpose. wasm/
                # is the wasm-bindgen package, and its .wasm is the URL every CDN
                # snippet in the docs hands to initialize(). dist/ holds the copy
                # the ESM entry finds next to itself (new URL('ssruntime_bg.wasm',
                # import.meta.url)) when initialize() is given no URL -- the file
                # a bundler emits, and the one an ESM import from a CDN fetches;
                # the build step copies it there. A tarball without that copy
                # installs and type-checks, then 404s on the runtime in every
                # bundled app.
                if ($p.Dir -eq "ssplayer-core" -and -not ($entries -contains "package/dist/ssruntime_bg.wasm")) {
                    Add-Failure "$tgzName has no dist/ssruntime_bg.wasm (the copy the ESM entry loads when initialize() is given no URL)"
                }
            }
        }

        # -- the plugin archives --
        #
        # Keyed on the expected filenames, and only once the channel has been
        # built at least once. For the .tbp the filename IS the plugin id, so a
        # renamed one has to read as missing rather than as
        # present-under-another-name.
        if (@(Get-ChildItem $pluginOut -File -ErrorAction SilentlyContinue).Count -gt 0) {
            foreach ($p in $PLUGIN_PKGS) {
                $name = Split-Path -Leaf $p.Artifact
                if (!(Test-Path (Join-Path $pluginOut $name))) {
                    Add-Failure "$name is missing from the plugins channel"
                }
            }
        }

        $rmmz = $PLUGIN_PKGS | Where-Object { $_.Dir -eq "ssplayer-rmmz" } | Select-Object -First 1
        if ($rmmz) {
            $rmmzZip = Join-Path $pluginOut (Split-Path -Leaf $rmmz.Artifact)
            if (Test-Path $rmmzZip) {
                $entries = Get-ZipEntries $rmmzZip
                # Flat, because RPG Maker MZ loads plugins as files in
                # js/plugins/ and the plugin finds its wasm next to itself
                # (document.currentScript).
                foreach ($f in @("ssplayer-rpgmakermz.js", "ssruntime_bg.wasm")) {
                    if (-not ($entries -contains $f)) {
                        Add-Failure "$(Split-Path -Leaf $rmmzZip) has no $f at the archive root"
                    }
                }
                # And the wasm is the no-SIMD build. MZ's NW.js Chromium predates
                # simd128, so the SIMD one installs, loads, and dies -- on a host
                # nothing here runs.
                if ($entries -contains "ssruntime_bg.wasm") {
                    $packedHash = Get-ZipEntryHash $rmmzZip "ssruntime_bg.wasm"
                    $expected = Get-FileSha256 (Join-Path $ROOT_DIR "packages/ssplayer-core/wasm-nosimd/ssruntime_bg.wasm")
                    if ($packedHash -ne $expected) {
                        Add-Failure "$(Split-Path -Leaf $rmmzZip) does not carry the no-SIMD runtime (RPG Maker MZ cannot load a simd128 wasm)"
                    }
                }
            }
        }

        $tyrano = $PLUGIN_PKGS | Where-Object { $_.Dir -eq "ssplayer-tyranoscript" } | Select-Object -First 1
        if ($tyrano) {
            $tyranoZip = Join-Path $pluginOut (Split-Path -Leaf $tyrano.Artifact)
            if (Test-Path $tyranoZip) {
                $entries = Get-ZipEntries $tyranoZip
                # One folder, dropped whole into data/others/plugin/.
                foreach ($f in @("ssplayer/init.ks", "ssplayer/main.js", "ssplayer/ssruntime_bg.wasm", "ssplayer/readme.txt")) {
                    if (-not ($entries -contains $f)) {
                        Add-Failure "$(Split-Path -Leaf $tyranoZip) has no $f"
                    }
                }
                if ($entries -contains "ssplayer/readme.txt") {
                    # The packer fills the version into the readme a creator
                    # actually reads.
                    if ((Get-ZipEntryText $tyranoZip "ssplayer/readme.txt") -match "\{\{VERSION\}\}") {
                        Add-Failure "$(Split-Path -Leaf $tyranoZip) ships readme.txt with {{VERSION}} unsubstituted"
                    }
                }
            }
        }

        $tbp = Join-Path $pluginOut "ssplayer.tbp"
        if (Test-Path $tbp) {
            # The builder derives the plugin id from the FILENAME, then reads
            # <id>/<id>.builder.js out of what it extracted. Both halves of that
            # have to hold, and neither is visible from inside the repo.
            $entries = Get-ZipEntries $tbp
            $tops = @($entries | ForEach-Object { ($_ -split "/")[0] } | Sort-Object -Unique)
            if ($tops.Count -ne 1 -or $tops[0] -ne "ssplayer") {
                Add-Failure "ssplayer.tbp does not hold exactly one top-level folder named 'ssplayer' (found: $($tops -join ' '))"
            }
            foreach ($f in @("ssplayer/ssplayer.builder.js", "ssplayer/main.js", "ssplayer/init.ks",
                             "ssplayer/ssruntime_bg.wasm", "ssplayer/ssconverter_bg.wasm")) {
                if (-not ($entries -contains $f)) { Add-Failure "ssplayer.tbp has no $f" }
            }
        }

        # -- the copy-paste snippets --
        # The docs, the READMEs and examples/cdn pin exact versions of these
        # packages. The release rewrites them right after the bump; a mismatch
        # HERE means the tree's own snippets already disagree with the tree's own
        # versions, which the release would carry straight through.
        if ((Invoke-Tolerant { & pnpm run check:docs }) -ne 0) {
            Add-Failure "the version pins in the docs/READMEs/examples disagree with package.json (run 'pnpm run sync:docs')"
        }

        # -- the checksums themselves --
        foreach ($line in [System.IO.File]::ReadAllLines((Join-Path $OUT "SHA256SUMS"))) {
            if (-not $line) { continue }
            $expected, $rel = $line -split "  ", 2
            $path = Join-Path $OUT $rel
            if (!(Test-Path $path) -or (Get-FileSha256 $path) -ne $expected) {
                Add-Failure "SHA256SUMS does not verify for $rel"
            }
        }

        if ($FAILED.Count -gt 0) {
            [Console]::Error.WriteLine("")
            [Console]::Error.WriteLine("${APP}: the artifacts in $OUT are not shippable:")
            foreach ($f in $FAILED) { [Console]::Error.WriteLine("  $f") }
            exit 1
        }
        Write-Host "   all checks passed"
    } else {
        Write-Host ""
        Write-Host ">> [verify] verify=no -- the artifacts are not checked"
    }
} finally {
    Pop-Location
}

# --- done -----------------------------------------------------------------
Write-Host ""
Write-Host "${APP}: done -> $OUT"
Write-Host ""
$listing = @{}
foreach ($f in (Get-ChildItem $OUT -Recurse -File)) {
    $listing[$f.FullName.Substring($OUT.Length + 1) -replace "\\", "/"] = $f.Length
}
# Ordinal, so the listing comes out in the order the .sh twin's `LC_ALL=C sort`
# produces rather than in this host's culture's.
$listed = [string[]] $listing.Keys
[Array]::Sort($listed, [StringComparer]::Ordinal)
foreach ($rel in $listed) {
    Write-Host ("  {0,10}  {1}" -f $listing[$rel], $rel)
}
Write-Host ""
Write-Host "${APP}: nothing was published. This is what a release would upload:"
Write-Host "  npm/*.tgz     the very files release.yml publishes to npm"
Write-Host "  plugins/*     the very files release.yml attaches to the plugins'"
Write-Host "                GitHub Releases -- it runs the .sh twin to build both"
if (@(Get-ChildItem (Join-Path $OUT "npm") -Filter "*.tgz" -File -ErrorAction SilentlyContinue).Count -gt 0) {
    Write-Host ""
    Write-Host "${APP}: try a tarball before shipping it -- install it into a scratch project:"
    Write-Host "  pnpm add $OUT/npm/<name>.tgz   (npm / yarn take the same file)"
}

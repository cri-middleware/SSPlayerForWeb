#!/usr/bin/env pwsh
#
# Generate the TypeScript FlatBuffers accessors from the SDK's .fbs schemas.
# PowerShell twin of scripts/generate-fbs-code.sh.

$ErrorActionPreference = "Stop"

$HelpApp = Split-Path -Leaf $PSCommandPath
function Show-Usage {
    Write-Host "Usage: ${HelpApp} [--help]"
    Write-Host "  flatc --ts over the SDK's .fbs schemas, into packages/ssplayer-core/src/ss/,"
    Write-Host "  then rewrites the namespace entrypoints flatc overwrites per file. Needs flatc."
}

foreach ($arg in $args) {
    switch -Regex ($arg) {
        '^(-h|--help|help)$' { Show-Usage; exit 0 }
        default {
            [Console]::Error.WriteLine("${HelpApp}: unknown argument '$arg'")
            Show-Usage
            exit 2
        }
    }
}

# Setup paths
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$SdkDir = Join-Path $ProjectRoot "SpriteStudio-SDK"
$TargetDir = Join-Path $ProjectRoot "packages/ssplayer-core/src"

if (-not (Get-Command flatc -ErrorAction SilentlyContinue)) {
    Write-Error "generate-fbs-code.ps1: flatc not on PATH"
}

Write-Host "Generating FlatBuffers TypeScript code..."

# flatc writes a file per table and never removes one, and the entrypoints
# below export every file it finds. Start from nothing, so a table the schema
# dropped is not left behind and still exported. src/ss holds flatc's output only.
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $TargetDir "ss")
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

foreach ($subdir in @("libs/ssruntime/fbs", "libs/ssab/fbs")) {
    foreach ($f in Get-ChildItem -Path (Join-Path $SdkDir $subdir) -Filter *.fbs | Sort-Object Name) {
        & flatc --ts -o $TargetDir $f.FullName
        if ($LASTEXITCODE -ne 0) { Write-Error "generate-fbs-code.ps1: flatc failed for $($f.Name)" }
    }
}

# flatc overwrites namespace entrypoints (like ss/runtime.ts and ss/format.ts)
# when run in a loop or with multiple files having the same namespace.
# We manually regenerate them to include all generated files.
foreach ($namespace in @("runtime", "format")) {
    $entrypoint = Join-Path $TargetDir "ss/$namespace.ts"
    $lines = @(
        "// Auto-generated entrypoint"
        "/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */"
    )
    $namespaceDir = Join-Path $TargetDir "ss/$namespace"
    if (Test-Path $namespaceDir) {
        foreach ($f in Get-ChildItem -Path $namespaceDir -Filter *.ts | Sort-Object Name) {
            $name = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
            # Find the exported classes/enums/functions in the file
            foreach ($line in Get-Content $f.FullName) {
                if ($line -match '^export (?:class|enum|function)\s+([A-Za-z0-9_$]+)') {
                    $lines += "export { $($Matches[1]) } from './$namespace/$name.js';"
                }
            }
        }
    }
    # LF, so the committed output is byte-identical to the .sh run's.
    [System.IO.File]::WriteAllText($entrypoint, ($lines -join "`n") + "`n")
}

Write-Host "FlatBuffers generation complete. Output saved to $TargetDir"

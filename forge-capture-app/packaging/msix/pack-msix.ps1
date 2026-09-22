<#
.SYNOPSIS
  Build an (unsigned) MSIX package of FORGE Capture for Microsoft Store submission.

.DESCRIPTION
  Tauri v2 does not emit MSIX, so this script wraps the raw Win32 exe
  (produced by `cargo tauri build --no-bundle`, or `cargo build --release`
  in forge-capture-app/app) with AppxManifest.template.xml and packs it
  with the Windows SDK makeappx.exe.

  The output is UNSIGNED. Upload it as-is to Partner Center — Microsoft
  signs Store submissions itself. Never buy or embed a certificate for
  the Store path.

  -SelfSign is for LOCAL install testing only: it creates a throwaway
  self-signed cert, signs the package, and exports the .cer so you can
  trust it once. Never upload a self-signed package to the Store.

.EXAMPLE
  # Full flow on a Windows machine (builds the exe, packs unsigned MSIX):
  .\pack-msix.ps1 -IdentityName "1234Publisher.FORGECapture" `
    -Publisher "CN=1234ABCD-..." -PublisherDisplayName "409 Marketplace LLC"

.EXAMPLE
  # Skip the rebuild when the exe already exists; self-sign for local install:
  .\pack-msix.ps1 -SkipBuild -SelfSign
#>
[CmdletBinding()]
param(
    [string]$IdentityName = "PLACEHOLDER.FORGECapture",
    [string]$Publisher = "CN=FORGE-Capture-Test",
    [string]$PublisherDisplayName = "409 Marketplace LLC",
    [string]$Version = "0.2.0.0",
    [ValidateSet("x64", "arm64")]
    [string]$Arch = "x64",
    [string]$ExePath = "",
    [switch]$SkipBuild,
    [switch]$SelfSign
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Resolve-Path (Join-Path $ScriptDir "..\..\app")
$OutDir = Join-Path $ScriptDir "out"
$StageDir = Join-Path $OutDir "stage"

function Find-MakeAppx {
    $cmd = Get-Command makeappx.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $kits = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
        "$env:ProgramFiles\Windows Kits\10\bin"
    )
    $found = @()
    foreach ($base in $kits) {
        if (Test-Path $base) {
            $found += Get-ChildItem -Path $base -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\x64\\' } |
                Select-Object -ExpandProperty FullName
        }
    }
    if ($found.Count -gt 0) { return ($found | Sort-Object -Descending | Select-Object -First 1) }
    return $null
}

# 1. Build the raw exe (no bundle) unless skipped.
if (-not $SkipBuild) {
    Write-Host "Building release exe (no bundle)..." -ForegroundColor Cyan
    Push-Location $AppDir
    try {
        # tauri-build codegen embeds the static UI (frontendDist ../ui);
        # --no-bundle skips the NSIS/MSI step we do not need here.
        cargo tauri build --no-bundle 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "cargo tauri not available; falling back to cargo build --release" -ForegroundColor Yellow
            cargo build --release
            if ($LASTEXITCODE -ne 0) { throw "release build failed" }
        }
    } finally { Pop-Location }
}

if ([string]::IsNullOrEmpty($ExePath)) {
    $ExePath = Join-Path $AppDir "target\release\forge-capture-app.exe"
}
if (-not (Test-Path $ExePath)) {
    throw "exe not found at $ExePath (build it first or pass -ExePath)"
}
Write-Host "Using exe: $ExePath" -ForegroundColor Cyan

# 2. Stage the payload.
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
$AssetsDir = New-Item -ItemType Directory -Force (Join-Path $StageDir "Assets")
Copy-Item $ExePath (Join-Path $StageDir "forge-capture-app.exe")

# 3. Generate the Store logo set from the 128px source icon.
Add-Type -AssemblyName System.Drawing
$SourceIcon = Join-Path $AppDir "icons\128x128.png"
if (-not (Test-Path $SourceIcon)) { throw "source icon missing: $SourceIcon" }
$src = [System.Drawing.Image]::FromFile($SourceIcon)
function Write-Logo($w, $h, $name, [switch]$Wide) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::Transparent)
    if ($Wide) {
        # Center the square logo on the wide tile.
        $size = $h
        $x = [int](($w - $size) / 2)
        $g.DrawImage($src, $x, 0, $size, $size)
    } else {
        $g.DrawImage($src, 0, 0, $w, $h)
    }
    $g.Dispose()
    $bmp.Save((Join-Path $AssetsDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}
Write-Logo 50 50 "StoreLogo.png"
Write-Logo 44 44 "Square44x44Logo.png"
Write-Logo 71 71 "Square71x71Logo.png"
Write-Logo 150 150 "Square150x150Logo.png"
Write-Logo 310 150 "Wide310x150Logo.png" -Wide
$src.Dispose()
Write-Host "Assets generated." -ForegroundColor Cyan

# 4. Fill the manifest template.
$manifest = Get-Content (Join-Path $ScriptDir "AppxManifest.template.xml") -Raw
$manifest = $manifest.Replace("{{IDENTITY_NAME}}", $IdentityName)
$manifest = $manifest.Replace("{{PUBLISHER}}", $Publisher)
$manifest = $manifest.Replace("{{PUBLISHER_DISPLAY_NAME}}", $PublisherDisplayName)
$manifest = $manifest.Replace("{{VERSION}}", $Version)
$manifest = $manifest.Replace("{{ARCH}}", $Arch)
$manifest | Set-Content (Join-Path $StageDir "AppxManifest.xml") -Encoding UTF8

if ($IdentityName.StartsWith("PLACEHOLDER")) {
    Write-Host "WARNING: using placeholder Identity/Name Publisher values — fine for local testing, NOT for Store upload." -ForegroundColor Yellow
}

# 5. Pack with makeappx.
$makeappx = Find-MakeAppx
if (-not $makeappx) {
    throw "makeappx.exe not found. Install the Windows SDK (`winget install Microsoft.WindowsSDK.10.0.26100`) or the winapp CLI (`winget install Microsoft.winappcli`; see README.md for the winapp alternative)."
}
$MsixPath = Join-Path $OutDir "FORGECapture_${Version}_${Arch}.msix"
Write-Host "Packing with $makeappx ..." -ForegroundColor Cyan
& $makeappx pack /d "$StageDir" /p "$MsixPath" /nv
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed" }
Write-Host "Unsigned MSIX: $MsixPath" -ForegroundColor Green

# 6. Optional TEST-ONLY self-sign for local install.
if ($SelfSign) {
    Write-Host ""
    Write-Host "SELF-SIGN IS FOR LOCAL TESTING ONLY. Never upload this package to the Store." -ForegroundColor Red
    $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher `
        -KeyUsage DigitalSignature -FriendlyName "FORGE Capture (test only)" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
    $pfxPath = Join-Path $OutDir "forge-capture-test.pfx"
    $cerPath = Join-Path $OutDir "forge-capture-test.cer"
    $pwd = ConvertTo-SecureString -String "forge-test" -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pwd | Out-Null
    Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
    $signtool = (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -ExpandProperty FullName -First 1)
    if (-not $signtool) { throw "signtool.exe not found in the Windows SDK" }
    & $signtool sign /fd SHA256 /f "$pfxPath" /p "forge-test" "$MsixPath"
    if ($LASTEXITCODE -ne 0) { throw "signtool failed" }
    Write-Host "Test-signed. Trust ONCE (admin): import $cerPath into Local Machine > Trusted People, then double-click the .msix." -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. For Store submission, upload the UNSIGNED .msix to Partner Center (see docs/product/forge-capture/MSIX_STORE_CHECKLIST.md)." -ForegroundColor Green

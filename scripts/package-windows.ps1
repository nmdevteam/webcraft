param(
  [Parameter(Mandatory = $true)][string]$NodeArchivePath,
  [Parameter(Mandatory = $true)][string]$PostgresArchivePath,
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'The Windows payload packager requires PowerShell 7 or later; run it through the GitHub Actions pwsh shell.' }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$NodeArchivePath = (Resolve-Path $NodeArchivePath).Path
$PostgresArchivePath = (Resolve-Path $PostgresArchivePath).Path
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $OutputRoot) {
  throw "Output directory already exists; refusing to overwrite it: $OutputRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'apps\builder\dist\index.html'))) {
  throw 'Build the production builder before assembling the Windows payload.'
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'apps\cms\.next\BUILD_ID'))) {
  throw 'Build the production CMS before assembling the Windows payload.'
}

$PayloadDir = Join-Path $OutputRoot 'payload'
$RuntimeDir = Join-Path $PayloadDir 'runtime'
$NodeDir = Join-Path $RuntimeDir 'node'
$PostgresDir = Join-Path $RuntimeDir 'postgres'
$CmsDir = Join-Path $RuntimeDir 'cms'
$BuilderDir = Join-Path $RuntimeDir 'builder'
$ExtractDir = Join-Path $OutputRoot 'extract'
New-Item -ItemType Directory -Path $NodeDir, $PostgresDir, $BuilderDir, $ExtractDir, (Join-Path $PayloadDir 'licenses') -Force | Out-Null

$NodeExtractDir = Join-Path $ExtractDir 'node'
$PostgresExtractDir = Join-Path $ExtractDir 'postgres'
New-Item -ItemType Directory -Path $NodeExtractDir, $PostgresExtractDir -Force | Out-Null
Expand-Archive -LiteralPath $NodeArchivePath -DestinationPath $NodeExtractDir -Force
Expand-Archive -LiteralPath $PostgresArchivePath -DestinationPath $PostgresExtractDir -Force

$NodeExeSource = Get-ChildItem -LiteralPath $NodeExtractDir -Filter 'node.exe' -File -Recurse | Select-Object -First 1
if (-not $NodeExeSource) { throw 'The official Node.js archive does not contain node.exe.' }
$NodeRoot = $NodeExeSource.Directory.FullName
$NodeVersionOutput = (& $NodeExeSource.FullName --version | Out-String).Trim()
if ($NodeVersionOutput -ne 'v24.22.3') { throw "Expected bundled Node v24.22.3, received $NodeVersionOutput." }
Copy-Item -LiteralPath $NodeExeSource.FullName -Destination (Join-Path $NodeDir 'node.exe')
$NodeLicenseSource = Join-Path $NodeRoot 'LICENSE'
if (-not (Test-Path -LiteralPath $NodeLicenseSource)) { throw 'The Node.js license file is missing from its official archive.' }
Copy-Item -LiteralPath $NodeLicenseSource -Destination (Join-Path $PayloadDir 'licenses\Node-LICENSE.txt')

$InitDbSource = Get-ChildItem -LiteralPath $PostgresExtractDir -Filter 'initdb.exe' -File -Recurse | Select-Object -First 1
if (-not $InitDbSource) { throw 'The PostgreSQL archive does not contain initdb.exe.' }
$PostgresBinSource = $InitDbSource.Directory.FullName
$PostgresRoot = Split-Path -Parent $PostgresBinSource
$PostgresVersionOutput = (& (Join-Path $PostgresBinSource 'pg_ctl.exe') --version | Out-String).Trim()
if ($PostgresVersionOutput -notmatch 'PostgreSQL\) 17\.12(?:\s|$)') {
  throw "Expected PostgreSQL 17.12 from the pinned EDB archive, received: $PostgresVersionOutput"
}
foreach ($DirectoryName in @('bin', 'lib', 'share')) {
  $SourceDirectory = Join-Path $PostgresRoot $DirectoryName
  if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) { throw "PostgreSQL archive is missing $DirectoryName." }
  Copy-Item -LiteralPath $SourceDirectory -Destination $PostgresDir -Recurse -Force
}
foreach ($RuntimeDll in @('vcruntime140.dll', 'vcruntime140_1.dll')) {
  $RuntimeDllSource = Get-ChildItem -LiteralPath $PostgresExtractDir -Filter $RuntimeDll -File -Recurse | Select-Object -First 1
  if (-not $RuntimeDllSource) { throw "The EDB archive is missing its bundled $RuntimeDll runtime dependency." }
  Copy-Item -LiteralPath $RuntimeDllSource.FullName -Destination (Join-Path $PostgresDir "bin\$RuntimeDll") -Force
}
foreach ($LicenseFile in @(
  @{ Source = 'server_license.txt'; Destination = 'PostgreSQL-server_license.txt' },
  @{ Source = 'commandlinetools_3rd_party_licenses.txt'; Destination = 'PostgreSQL-commandlinetools_3rd_party_licenses.txt' }
)) {
  $LicenseSource = Join-Path $PostgresRoot $LicenseFile.Source
  if (-not (Test-Path -LiteralPath $LicenseSource)) { throw "The EDB archive is missing $($LicenseFile.Source)." }
  Copy-Item -LiteralPath $LicenseSource -Destination (Join-Path $PayloadDir "licenses\$($LicenseFile.Destination)")
}

$Pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $Pnpm) { throw 'pnpm is required to create the production CMS deployment.' }
& $Pnpm.Source deploy --legacy --filter '@webcraft/cms' --prod $CmsDir
if ($LASTEXITCODE -ne 0) { throw "pnpm deploy failed with exit code $LASTEXITCODE." }
$RequiredCmsFiles = @(
  (Join-Path $CmsDir 'node_modules\payload\bin.js'),
  (Join-Path $CmsDir 'node_modules\next\dist\bin\next'),
  (Join-Path $CmsDir 'payload.config.ts'),
  (Join-Path $CmsDir 'scripts\migrate-media.mjs'),
  (Join-Path $CmsDir '.next\BUILD_ID')
)
foreach ($RequiredFile in $RequiredCmsFiles) {
  if (-not (Test-Path -LiteralPath $RequiredFile)) { throw "The production CMS deployment is missing: $RequiredFile" }
}
$MigrationFiles = Get-ChildItem -LiteralPath (Join-Path $CmsDir 'src\migrations') -Filter '*.ts' -File -Recurse
if (@($MigrationFiles).Count -eq 0) { throw 'The production CMS deployment has no database migration files.' }
$EnvironmentFiles = @(Get-ChildItem -LiteralPath $CmsDir -File -Recurse -Force | Where-Object { $_.Name -match '^\.env($|\.(local|development|production|test)(\.local)?$)' })
if ($EnvironmentFiles.Count -gt 0) { throw "Refusing to package environment file(s): $($EnvironmentFiles.Name -join ', ')" }
foreach ($CacheName in @('cache', 'dev', 'standalone')) {
  $CachePath = Join-Path $CmsDir ".next\$CacheName"
  if (Test-Path -LiteralPath $CachePath) { Remove-Item -LiteralPath $CachePath -Recurse -Force }
}
Copy-Item -Path (Join-Path $RepoRoot 'apps\builder\dist\*') -Destination $BuilderDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'apps\runtime\server.mjs') -Destination (Join-Path $RuntimeDir 'server.mjs')
Copy-Item -LiteralPath (Join-Path $RepoRoot 'apps\runtime\launcher.mjs') -Destination (Join-Path $RuntimeDir 'launcher.mjs')

$Manifest = [ordered]@{ cmsDir = 'cms'; builderDir = 'builder' }
$Manifest | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $RuntimeDir 'manifest.json') -Encoding utf8NoBOM
$StartScript = @"
@echo off
setlocal
if not defined WEBCRAFT_DATA_DIR set "WEBCRAFT_DATA_DIR=%LOCALAPPDATA%\WebCraft"
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0Start-WebCraft.ps1" -ArchivePath "%~dp0WebCraft-runtime-v$Version.zip" -RuntimeVersion "$Version"
exit /b %errorlevel%
"@
Set-Content -LiteralPath (Join-Path $PayloadDir 'Start WebCraft.cmd') -Value $StartScript -Encoding ascii
Copy-Item -LiteralPath (Join-Path $RepoRoot 'packaging\windows\Start-WebCraft.ps1') -Destination (Join-Path $PayloadDir 'Start-WebCraft.ps1')
Copy-Item -LiteralPath (Join-Path $RepoRoot 'packaging\windows\README.txt') -Destination (Join-Path $PayloadDir 'README.txt')
$WebCraftLicenseSource = Join-Path $RepoRoot 'LICENSE'
if (-not (Test-Path -LiteralPath $WebCraftLicenseSource -PathType Leaf)) { throw 'The WebCraft LICENSE file is required by the MSI and is missing from the repository.' }
Copy-Item -LiteralPath $WebCraftLicenseSource -Destination (Join-Path $PayloadDir 'licenses\WebCraft-LICENSE.txt')
$Notices = @"
WebCraft $Version — bundled software notices

Node.js v24.22.3 is bundled from the official Windows x64 archive as the standalone node.exe in the runtime archive. Its upstream license is included at licenses\Node-LICENSE.txt.

PostgreSQL 17.12 Windows x64 binaries from EDB are bundled for local-only database use. The PostgreSQL server license and the command-line tools' third-party license notices are included at licenses\PostgreSQL-server_license.txt and licenses\PostgreSQL-commandlinetools_3rd_party_licenses.txt. PostgreSQL runtime files and the EDB archive's Visual C++ runtime DLLs are included in the runtime archive.

The EDB archive's VCRUNTIME140.dll and VCRUNTIME140_1.dll are included with the bundled PostgreSQL executables. Microsoft runtime information: https://www.microsoft.com/en-us/download/details.aspx?id=48145.

The CMS production dependencies are pinned by pnpm-lock.yaml; package license notices distributed with those production dependencies remain under cms\node_modules inside the runtime archive. WebCraft's license is included at licenses\WebCraft-LICENSE.txt.

WiX Toolset is used only to build the MSI in CI; it is not bundled or installed with WebCraft.
"@
Set-Content -LiteralPath (Join-Path $PayloadDir 'THIRD-PARTY-NOTICES.txt') -Value $Notices -Encoding utf8

Add-Type -AssemblyName System.IO.Compression.FileSystem
$RuntimeArchivePath = Join-Path $PayloadDir "WebCraft-runtime-v$Version.zip"
[System.IO.Compression.ZipFile]::CreateFromDirectory($RuntimeDir, $RuntimeArchivePath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$RuntimeArchiveInfo = Get-Item -LiteralPath $RuntimeArchivePath
Write-Output "Runtime archive size: $([math]::Round($RuntimeArchiveInfo.Length / 1GB, 3)) GiB"
if ($RuntimeArchiveInfo.Length -gt 1.9GB) { throw 'The runtime ZIP exceeds the 1.9 GiB safety ceiling beneath Windows Installer per-file limits.' }
$RuntimeArchive = [System.IO.Compression.ZipFile]::OpenRead($RuntimeArchivePath)
try {
  $Entries = $RuntimeArchive.Entries
  $RequiredEntries = @('launcher.mjs', 'manifest.json', 'node/node.exe', 'postgres/bin/initdb.exe', 'cms/.next/BUILD_ID', 'builder/index.html')
  foreach ($RequiredEntry in $RequiredEntries) {
    if (-not ($Entries | Where-Object { $_.FullName -ceq $RequiredEntry })) { throw "Runtime ZIP is missing required entry: $RequiredEntry" }
  }
  if (-not ($Entries | Where-Object { $_.FullName -like 'cms/src/migrations/*.ts' })) { throw 'Runtime ZIP contains no CMS database migrations.' }
  $PackedEnvironmentFiles = @($Entries | Where-Object { $_.Name -match '^\.env($|\.(local|development|production|test)(\.local)?$)' })
  if ($PackedEnvironmentFiles.Count -gt 0) { throw "Refusing to package environment file(s): $($PackedEnvironmentFiles.FullName -join ', ')" }
  Write-Output "Verified runtime ZIP entries: $($Entries.Count)"
} finally {
  $RuntimeArchive.Dispose()
}
Remove-Item -LiteralPath $RuntimeDir -Recurse -Force
Remove-Item -LiteralPath $ExtractDir -Recurse -Force

Write-Output "Windows payload assembled at: $PayloadDir"
Write-Output "Runtime archive: $RuntimeArchivePath ($([math]::Round($RuntimeArchiveInfo.Length / 1MB, 1)) MiB)"
Write-Output "Node: $NodeVersionOutput"
Write-Output "PostgreSQL: $PostgresVersionOutput"

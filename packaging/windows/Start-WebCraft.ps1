#requires -Version 5.0
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$RuntimeVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Test-WebCraftRuntime {
  param([Parameter(Mandatory = $true)][string]$Root)
  foreach ($RelativePath in @(
    'launcher.mjs',
    'manifest.json',
    'node\node.exe',
    'postgres\bin\initdb.exe',
    'cms\.next\BUILD_ID',
    'builder\index.html'
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $RelativePath) -PathType Leaf)) { return $false }
  }
  $Migrations = Join-Path $Root 'cms\src\migrations'
  if (-not (Test-Path -LiteralPath $Migrations -PathType Container)) { return $false }
  return @((Get-ChildItem -LiteralPath $Migrations -Filter '*.ts' -File -Recurse -ErrorAction SilentlyContinue)).Count -gt 0
}

if ([string]::IsNullOrWhiteSpace($env:WEBCRAFT_DATA_DIR)) {
  if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { throw 'WebCraft could not determine this Windows account’s local application data directory.' }
  $DataRoot = Join-Path $env:LOCALAPPDATA 'WebCraft'
} else {
  $DataRoot = $env:WEBCRAFT_DATA_DIR
}
$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$env:WEBCRAFT_DATA_DIR = $DataRoot
New-Item -ItemType Directory -Path $DataRoot -Force | Out-Null
$ArchivePath = (Resolve-Path -LiteralPath $ArchivePath).Path
$RuntimeRoot = Join-Path $DataRoot "runtime-$RuntimeVersion"
$LockPath = Join-Path $DataRoot ".webcraft-runtime-$RuntimeVersion.lock"
$StagingPath = Join-Path $DataRoot ".tmp-$RuntimeVersion"
$Deadline = [DateTime]::UtcNow.AddMinutes(15)
$LockStream = $null

try {
  while (-not (Test-WebCraftRuntime -Root $RuntimeRoot)) {
    try {
      $LockStream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      break
    } catch [System.IO.IOException] {
      if ([DateTime]::UtcNow -ge $Deadline) { throw 'Another WebCraft runtime extraction is still in progress. Wait for it to finish, then try again.' }
      Start-Sleep -Seconds 2
    }
  }

  if ($null -ne $LockStream) {
    try {
      if (-not (Test-WebCraftRuntime -Root $RuntimeRoot)) {
        if (Test-Path -LiteralPath $RuntimeRoot) { Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force }
        if (Test-Path -LiteralPath $StagingPath) { Remove-Item -LiteralPath $StagingPath -Recurse -Force }
        New-Item -ItemType Directory -Path $StagingPath -Force | Out-Null

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $Archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
        try {
          foreach ($Entry in $Archive.Entries) {
            $EntryName = $Entry.FullName.Replace('\', '/')
            if ($EntryName.StartsWith('/') -or $EntryName -match '^[A-Za-z]:' -or $EntryName -match '(^|/)\.\.?(/|$)') {
              throw "The WebCraft runtime archive contains an unsafe path: $($Entry.FullName)"
            }
            $DestinationPath = Join-Path $StagingPath ($EntryName.Replace('/', '\'))
            $RuntimePath = Join-Path $RuntimeRoot ($EntryName.Replace('/', '\'))
            if ($DestinationPath.Length -ge 240 -or $RuntimePath.Length -ge 240) {
              $PathLength = [math]::Max($DestinationPath.Length, $RuntimePath.Length)
              throw "The WebCraft runtime entry '$EntryName' would use a $PathLength-character Windows path. Set WEBCRAFT_DATA_DIR to a shorter local folder and try again."
            }
          }
        } finally {
          $Archive.Dispose()
        }

        Write-Host "Preparing WebCraft $RuntimeVersion on this Windows account. The first launch may take several minutes."
        Expand-Archive -LiteralPath $ArchivePath -DestinationPath $StagingPath -ErrorAction Stop
        if (-not (Test-WebCraftRuntime -Root $StagingPath)) { throw 'The extracted WebCraft runtime is incomplete; the application was not started.' }
        [System.IO.Directory]::Move($StagingPath, $RuntimeRoot)
      }
    } finally {
      $LockStream.Dispose()
      $LockStream = $null
    }
  }
} finally {
  if ($null -ne $LockStream) { $LockStream.Dispose() }
  if (Test-Path -LiteralPath $StagingPath) { Remove-Item -LiteralPath $StagingPath -Recurse -Force -ErrorAction SilentlyContinue }
}

$NodeExe = Join-Path $RuntimeRoot 'node\node.exe'
$Launcher = Join-Path $RuntimeRoot 'launcher.mjs'
& $NodeExe $Launcher
exit $LASTEXITCODE

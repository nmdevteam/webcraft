param(
  [Parameter(Mandatory = $true)][string]$MsiPath,
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'WebCraft'),
  [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$RuntimeVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$MsiPath = (Resolve-Path $MsiPath).Path
$DataDir = Join-Path $env:RUNNER_TEMP ("webcraft-smoke-" + [guid]::NewGuid().ToString('N'))
$RuntimeDir = Join-Path $DataDir "runtime-$RuntimeVersion"
$StdoutLog = Join-Path $env:RUNNER_TEMP 'webcraft-smoke.stdout.log'
$StderrLog = Join-Path $env:RUNNER_TEMP 'webcraft-smoke.stderr.log'
$LauncherProcess = $null
$InstallAttempted = $false
$MsiProductPath = $MsiPath
$StartMenuFolder = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\WebCraft'
$StartMenuShortcut = Join-Path $StartMenuFolder 'WebCraft.lnk'
$ProductRegistryKey = 'HKLM:\Software\NM Developers\WebCraft'
$EnvironmentNames = @('WEBCRAFT_DATA_DIR', 'WEBCRAFT_DB_PORT', 'WEBCRAFT_CMS_PORT', 'WEBCRAFT_APP_PORT', 'WEBCRAFT_NO_BROWSER')
$PreviousEnvironment = @{}
foreach ($Name in $EnvironmentNames) { $PreviousEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process') }

function Get-FreeLoopbackPort {
  $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $Listener.Start()
    return [int]$Listener.LocalEndpoint.Port
  } finally {
    $Listener.Stop()
  }
}

function Get-Diagnostics {
  $Parts = @()
  $SecretValues = @()
  $RuntimeConfigPath = Join-Path $DataDir 'runtime.json'
  if (Test-Path -LiteralPath $RuntimeConfigPath) {
    try {
      $Config = Get-Content -LiteralPath $RuntimeConfigPath -Raw | ConvertFrom-Json
      $SecretValues = @($Config.databasePassword, $Config.payloadSecret, $Config.webcraftSecret) | Where-Object { $_ -is [string] -and $_.Length -gt 0 }
    } catch { $SecretValues = @() }
  }
  foreach ($Path in @($StdoutLog, $StderrLog, (Join-Path $DataDir 'logs\cms.log'), (Join-Path $DataDir 'logs\migrations.log'), (Join-Path $DataDir 'logs\postgres.log'))) {
    if (Test-Path -LiteralPath $Path) {
      $Parts += "--- $Path (last lines) ---"
      $Text = Get-Content -LiteralPath $Path -Tail 40 | Out-String
      foreach ($SecretValue in $SecretValues) { $Text = $Text.Replace($SecretValue, '[REDACTED]') }
      $Parts += $Text
    }
  }
  return ($Parts -join "`n")
}

function Stop-WebCraft {
  if ($null -ne $LauncherProcess -and -not $LauncherProcess.HasExited) {
    & taskkill.exe /PID $LauncherProcess.Id /T /F 2>$null | Out-Null
    $LauncherProcess.WaitForExit(15000) | Out-Null
  }
  $PgData = Join-Path $DataDir 'postgres'
  $PgCtl = Join-Path $RuntimeDir 'postgres\bin\pg_ctl.exe'
  if ((Test-Path -LiteralPath $PgCtl) -and (Test-Path -LiteralPath (Join-Path $PgData 'PG_VERSION'))) {
    & $PgCtl -D $PgData -m fast -w stop 2>&1 | Out-Null
  }
}

function Invoke-Msi {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $Result = Start-Process -FilePath 'msiexec.exe' -ArgumentList $Arguments -Wait -PassThru -WindowStyle Hidden
  if ($Result.ExitCode -notin @(0, 3010)) { throw "msiexec failed with exit code $($Result.ExitCode)." }
}

try {
  if (Test-Path -LiteralPath $InstallDir) { throw "Unexpected pre-existing installation folder: $InstallDir" }
  if (Test-Path -LiteralPath $StartMenuFolder) { throw "Unexpected pre-existing Start menu folder: $StartMenuFolder" }
  if (Test-Path -LiteralPath $ProductRegistryKey) { throw "Unexpected pre-existing WebCraft registry key: $ProductRegistryKey" }
  $InstallAttempted = $true
  Invoke-Msi -Arguments @('/i', "`"$MsiProductPath`"", '/qn', '/norestart')
  foreach ($RequiredPath in @(
    (Join-Path $InstallDir 'Start WebCraft.cmd'),
    (Join-Path $InstallDir 'Start-WebCraft.ps1'),
    (Join-Path $InstallDir "WebCraft-runtime-v$RuntimeVersion.zip"),
    (Join-Path $InstallDir 'README.txt'),
    (Join-Path $InstallDir 'THIRD-PARTY-NOTICES.txt'),
    (Join-Path $InstallDir 'licenses\WebCraft-LICENSE.txt'),
    (Join-Path $InstallDir 'licenses\Node-LICENSE.txt'),
    (Join-Path $InstallDir 'licenses\PostgreSQL-server_license.txt'),
    (Join-Path $InstallDir 'licenses\PostgreSQL-commandlinetools_3rd_party_licenses.txt')
  )) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) { throw "MSI installation is missing $RequiredPath" }
  }
  if (Test-Path -LiteralPath $RuntimeDir) { throw 'The per-user runtime cache already exists before the first application launch.' }
  $StartMenuShortcut = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\WebCraft\WebCraft.lnk'
  if (-not (Test-Path -LiteralPath $StartMenuShortcut)) { throw "The WebCraft Start menu shortcut was not installed: $StartMenuShortcut" }

  $EnvValues = @{
    WEBCRAFT_DATA_DIR = $DataDir
    WEBCRAFT_DB_PORT = [string](Get-FreeLoopbackPort)
    WEBCRAFT_CMS_PORT = [string](Get-FreeLoopbackPort)
    WEBCRAFT_APP_PORT = [string](Get-FreeLoopbackPort)
    WEBCRAFT_NO_BROWSER = '1'
  }
  foreach ($Name in $EnvValues.Keys) { [Environment]::SetEnvironmentVariable($Name, $EnvValues[$Name], 'Process') }
  $StartCommand = Join-Path $InstallDir 'Start WebCraft.cmd'
  $StartCommandArgument = '""' + $StartCommand + '""'
  $LauncherProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/s', '/c', $StartCommandArgument) -WorkingDirectory $InstallDir -PassThru -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -WindowStyle Hidden

  $Deadline = [DateTime]::UtcNow.AddMinutes(15)
  $Ready = $false
  while ([DateTime]::UtcNow -lt $Deadline) {
    if ($LauncherProcess.HasExited) { throw "WebCraft launcher exited with code $($LauncherProcess.ExitCode).`n$(Get-Diagnostics)" }
    $RuntimeConfigPath = Join-Path $DataDir 'runtime.json'
    if (Test-Path -LiteralPath $RuntimeConfigPath) {
      try {
        $RuntimeConfig = Get-Content -LiteralPath $RuntimeConfigPath -Raw | ConvertFrom-Json
        $AppPort = [int]$RuntimeConfig.ports.app
        $BuilderResponse = Invoke-WebRequest -Uri "http://127.0.0.1:$AppPort/" -TimeoutSec 5
        if ($BuilderResponse.StatusCode -ne 200 -or $BuilderResponse.Content -notmatch '(?i)<html') { throw 'The builder page did not return its expected HTML document.' }
        $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$AppPort/api/webcraft-health" -TimeoutSec 5
        if ($Health.status -ne 'ok' -or $Health.database -ne 'ok') { throw "Database health response was not successful: $($Health | ConvertTo-Json -Compress)" }
        $Ready = $true
        break
      } catch {
        if ($LauncherProcess.HasExited) { throw "WebCraft stopped during smoke checks: $_`n$(Get-Diagnostics)" }
      }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $Ready) { throw "WebCraft did not serve the builder and database-backed health endpoint within fifteen minutes.`n$(Get-Diagnostics)" }
  foreach ($RequiredRuntimePath in @(
    (Join-Path $RuntimeDir 'launcher.mjs'),
    (Join-Path $RuntimeDir 'node\node.exe'),
    (Join-Path $RuntimeDir 'postgres\bin\initdb.exe'),
    (Join-Path $RuntimeDir 'cms\.next\BUILD_ID'),
    (Join-Path $RuntimeDir 'cms\src\migrations'),
    (Join-Path $RuntimeDir 'builder\index.html')
  )) {
    if (-not (Test-Path -LiteralPath $RequiredRuntimePath)) { throw "First-launch extraction is missing $RequiredRuntimePath" }
  }
  $ExtractedEnvironmentFiles = @(Get-ChildItem -LiteralPath (Join-Path $RuntimeDir 'cms') -File -Recurse -Force | Where-Object { $_.Name -match '^\.env($|\.(local|development|production|test)(\.local)?$)' })
  if ($ExtractedEnvironmentFiles.Count -gt 0) { throw "An environment file was included in the extracted CMS: $($ExtractedEnvironmentFiles.Name -join ', ')" }

  Stop-WebCraft
  $LauncherProcess = $null
  if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'runtime.json'))) { throw 'The runtime settings were not kept in the per-user data directory.' }
  if (-not (Test-Path -LiteralPath $RuntimeDir)) { throw 'The extracted runtime cache was not kept in the per-user data directory.' }
  Invoke-Msi -Arguments @('/x', "`"$MsiProductPath`"", '/qn', '/norestart')
  if (Test-Path -LiteralPath $InstallDir) { throw 'Uninstall did not remove the application files.' }
  if (Test-Path -LiteralPath $StartMenuShortcut) { throw 'Uninstall did not remove the Start menu shortcut.' }
  if (Test-Path -LiteralPath $StartMenuFolder) {
    if (@(Get-ChildItem -LiteralPath $StartMenuFolder -Force).Count -gt 0) { throw 'Uninstall left unexpected files in the WebCraft Start menu folder.' }
    Remove-Item -LiteralPath $StartMenuFolder -Force
  }
  if (Test-Path -LiteralPath $ProductRegistryKey) { Remove-Item -LiteralPath $ProductRegistryKey -Recurse -Force }
  if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'runtime.json'))) { throw 'Uninstall removed WebCraft user data; this is not the expected preservation behavior.' }
  if (-not (Test-Path -LiteralPath $RuntimeDir)) { throw 'Uninstall removed the extracted runtime cache; this is not the expected preservation behavior.' }
  $InstallAttempted = $false
  Write-Output 'Windows MSI smoke test passed: installation, first-launch runtime extraction, builder page, PostgreSQL-backed health endpoint, clean process stop, uninstall, and user-data/runtime retention.'
} catch {
  Write-Error "Windows MSI smoke test failed: $_`n$(Get-Diagnostics)"
  throw
} finally {
  Stop-WebCraft
  if ($InstallAttempted -and (Test-Path -LiteralPath $MsiProductPath)) {
    try { Invoke-Msi -Arguments @('/x', "`"$MsiProductPath`"", '/qn', '/norestart') } catch { Write-Warning "Could not remove the test MSI installation: $_" }
    foreach ($OwnedPath in @($InstallDir, $StartMenuShortcut)) {
      if (Test-Path -LiteralPath $OwnedPath) {
        try { Remove-Item -LiteralPath $OwnedPath -Recurse -Force -ErrorAction Stop } catch { Write-Warning "Could not remove test-owned MSI path $OwnedPath`: $_" }
      }
    }
    if (Test-Path -LiteralPath $StartMenuFolder) {
      try {
        if (@(Get-ChildItem -LiteralPath $StartMenuFolder -Force).Count -eq 0) { Remove-Item -LiteralPath $StartMenuFolder -Force -ErrorAction Stop }
      } catch { Write-Warning "Could not remove the empty test Start menu folder: $_" }
    }
    if (Test-Path -LiteralPath $ProductRegistryKey) {
      try { Remove-Item -LiteralPath $ProductRegistryKey -Recurse -Force -ErrorAction Stop } catch { Write-Warning "Could not remove the test WebCraft registry key: $_" }
    }
  }
  foreach ($Name in $EnvironmentNames) { [Environment]::SetEnvironmentVariable($Name, $PreviousEnvironment[$Name], 'Process') }
  if (Test-Path -LiteralPath $DataDir) { Remove-Item -LiteralPath $DataDir -Recurse -Force -ErrorAction SilentlyContinue }
}

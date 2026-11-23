param(
  [Parameter(Mandatory = $true)][string]$MsiPath,
  [string]$InstallDir = (Join-Path $env:ProgramFiles 'WebCraft')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$MsiPath = (Resolve-Path $MsiPath).Path
$DataDir = Join-Path $env:RUNNER_TEMP ("webcraft-smoke-" + [guid]::NewGuid().ToString('N'))
$StdoutLog = Join-Path $env:RUNNER_TEMP 'webcraft-smoke.stdout.log'
$StderrLog = Join-Path $env:RUNNER_TEMP 'webcraft-smoke.stderr.log'
$LauncherProcess = $null
$Installed = $false
$MsiProductPath = $MsiPath
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
  $PgCtl = Join-Path $InstallDir 'runtime\postgres\bin\pg_ctl.exe'
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
  Invoke-Msi -Arguments @('/i', "`"$MsiProductPath`"", '/qn', '/norestart')
  $Installed = $true
  foreach ($RequiredPath in @(
    (Join-Path $InstallDir 'Start WebCraft.cmd'),
    (Join-Path $InstallDir 'runtime\launcher.mjs'),
    (Join-Path $InstallDir 'runtime\node\node.exe'),
    (Join-Path $InstallDir 'runtime\postgres\bin\initdb.exe'),
    (Join-Path $InstallDir 'runtime\cms\.next\BUILD_ID'),
    (Join-Path $InstallDir 'runtime\cms\src\migrations'),
    (Join-Path $InstallDir 'runtime\builder\index.html'),
    (Join-Path $InstallDir 'README.txt'),
    (Join-Path $InstallDir 'THIRD-PARTY-NOTICES.txt')
  )) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) { throw "MSI installation is missing $RequiredPath" }
  }
  $StartMenuShortcut = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\WebCraft\WebCraft.lnk'
  if (-not (Test-Path -LiteralPath $StartMenuShortcut)) { throw "The WebCraft Start menu shortcut was not installed: $StartMenuShortcut" }
  foreach ($EnvironmentName in @('.env', '.env.local', '.env.production')) {
    if (Test-Path -LiteralPath (Join-Path $InstallDir "runtime\cms\$EnvironmentName")) { throw "An environment file was included in the installed CMS: $EnvironmentName" }
  }

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

  $Deadline = [DateTime]::UtcNow.AddMinutes(7)
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
  if (-not $Ready) { throw "WebCraft did not serve the builder and database-backed health endpoint within seven minutes.`n$(Get-Diagnostics)" }

  Stop-WebCraft
  $LauncherProcess = $null
  if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'runtime.json'))) { throw 'The runtime settings were not kept in the per-user data directory.' }
  Invoke-Msi -Arguments @('/x', "`"$MsiProductPath`"", '/qn', '/norestart')
  $Installed = $false
  if (Test-Path -LiteralPath $InstallDir) { throw 'Uninstall did not remove the application files.' }
  if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'runtime.json'))) { throw 'Uninstall removed WebCraft user data; this is not the expected preservation behavior.' }
  Write-Output 'Windows MSI smoke test passed: installation, builder page, PostgreSQL-backed health endpoint, clean process stop, and uninstall data retention.'
} catch {
  Write-Error "Windows MSI smoke test failed: $_`n$(Get-Diagnostics)"
  throw
} finally {
  Stop-WebCraft
  if ($Installed -and (Test-Path -LiteralPath $MsiProductPath)) {
    try { Invoke-Msi -Arguments @('/x', "`"$MsiProductPath`"", '/qn', '/norestart') } catch { Write-Warning "Could not remove the test MSI installation: $_" }
  }
  foreach ($Name in $EnvironmentNames) { [Environment]::SetEnvironmentVariable($Name, $PreviousEnvironment[$Name], 'Process') }
  if (Test-Path -LiteralPath $DataDir) { Remove-Item -LiteralPath $DataDir -Recurse -Force -ErrorAction SilentlyContinue }
}

<#
.SYNOPSIS
  Smoke-tests a packaged murasaki Windows app (<App>.exe, produced by
  `murasaki bundle --target win32-x64` — see packages/murasaki/src/cli/bundle.ts's
  bundleWin32 and crates/native/src/launcher.rs's imp_win module).

.DESCRIPTION
  Launches the app's murasaki-launcher.exe with stdout/stderr redirected,
  waits for it to relay prod-server.mjs's "MURASAKI_PORT=<n>" line (the same
  handshake crates/native/src/launcher.rs's shared::spawn_prod_server /
  wait_for_port perform), then polls that port for an HTTP 200 — i.e.
  confirms the launcher actually spawned node.exe and the bundled backend
  served a request, not just that a window appeared.

  Also asserts the launcher process is still alive a couple seconds after the
  backend responds: node comes up *before* the tao window / wry WebView2
  webview are created (see imp_win::run_inner's ordering), so a 200 response
  alone wouldn't catch a window/webview-creation failure that happens right
  after.

  Always force-kills the launcher and any child processes (notably
  resources/node.exe) before exiting, redirected or not — Windows has no
  equivalent to prod-server.mjs's POSIX `ppid === 1` orphan self-check (see
  that file), so nothing else will clean up a lingering node.exe here.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,

  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ExePath)) {
  Write-Error "murasaki-launcher exe not found at: $ExePath"
  exit 1
}

function Get-ChildProcessIds([int]$ParentId) {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentId" |
    Select-Object -ExpandProperty ProcessId
}

function Stop-ProcessTree([int]$RootId) {
  foreach ($childId in (Get-ChildProcessIds $RootId)) {
    Stop-ProcessTree $childId
  }
  Stop-Process -Id $RootId -Force -ErrorAction SilentlyContinue
}

Write-Host "Launching $ExePath ..."

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ExePath
$psi.WorkingDirectory = Split-Path -Parent $ExePath
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi

$stdout = New-Object System.Text.StringBuilder
$stderr = New-Object System.Text.StringBuilder

Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
  if ($null -ne $Event.SourceEventArgs.Data) {
    Write-Host "[launcher] $($Event.SourceEventArgs.Data)"
    [void]$Event.MessageData.AppendLine($Event.SourceEventArgs.Data)
  }
} -MessageData $stdout | Out-Null

Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
  if ($null -ne $Event.SourceEventArgs.Data) {
    Write-Host "[launcher:stderr] $($Event.SourceEventArgs.Data)"
    [void]$Event.MessageData.AppendLine($Event.SourceEventArgs.Data)
  }
} -MessageData $stderr | Out-Null

[void]$proc.Start()
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$exitCode = 1

try {
  # Phase 1: wait for the relayed "MURASAKI_PORT=<n>" line — proves the
  # launcher spawned resources/node.exe and it started listening.
  $port = $null
  while (-not $port -and (Get-Date) -lt $deadline) {
    if ($stdout.ToString() -match 'MURASAKI_PORT=(\d+)') {
      $port = [int]$Matches[1]
      break
    }
    if ($proc.HasExited) {
      Write-Error "murasaki-launcher exited early (code $($proc.ExitCode)) before reporting a port."
      throw 'early-exit'
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $port) {
    Write-Error "Timed out after ${TimeoutSeconds}s waiting for MURASAKI_PORT."
    throw 'port-timeout'
  }

  Write-Host "Backend reported port $port — polling http://127.0.0.1:$port/ ..."

  # Phase 2: poll the backend for an HTTP 200 — proves prod-server.mjs is
  # actually serving, not just that node started.
  $ok = $false
  while (-not $ok -and (Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -eq 200) { $ok = $true; break }
    } catch {
      # Not ready yet (or the launcher crashed after printing the port) —
      # keep polling until the shared deadline.
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $ok) {
    Write-Error "Never got HTTP 200 from 127.0.0.1:$port within the timeout."
    throw 'http-timeout'
  }

  Write-Host 'Got HTTP 200 from the packaged app backend.'

  # Phase 3: the tao window / wry WebView2 webview are created *after* node
  # comes up (imp_win::run_inner) — give that a couple seconds and confirm
  # the process is still alive, so a window/WebView2-creation failure right
  # after the backend responds doesn't get reported as a pass.
  Start-Sleep -Seconds 2
  if ($proc.HasExited) {
    Write-Error "murasaki-launcher exited (code $($proc.ExitCode)) shortly after the backend came up — window/webview creation likely failed."
    throw 'post-exit'
  }

  Write-Host 'murasaki-launcher is still running — smoke test passed.'
  $exitCode = 0
} finally {
  if (-not $proc.HasExited) {
    Stop-ProcessTree -RootId $proc.Id
  } else {
    # The launcher may already be gone but resources/node.exe (spawned as
    # its child) isn't guaranteed to have exited with it — see this script's
    # doc comment on the lack of a Windows orphan self-check.
    Get-Process -Name 'node' -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -and (Split-Path -Parent $_.Path) -eq (Split-Path -Parent $ExePath) + '\resources' } |
      ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  }

  if ($stdout.Length -gt 0) {
    Write-Host '--- full stdout ---'
    Write-Host $stdout.ToString()
  }
  if ($stderr.Length -gt 0) {
    Write-Host '--- full stderr ---'
    Write-Host $stderr.ToString()
  }
}

exit $exitCode

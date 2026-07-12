<#
.SYNOPSIS
  End-to-end verifies the Windows auto-updater apply mechanism (the frozen
  updater contract's §8) against a REAL installed murasaki app, by invoking
  the installed launcher's `--apply-update` mode directly.

.DESCRIPTION
  Why directly, and not through the webview/appQuit path: this script used to
  drive the update by launching the installed app, letting its WebView2 load
  an injected script that posted `{ kind: 'appQuit' }`, and waiting for that
  to trigger the launcher's event loop to spawn the apply-helper. That cannot
  run on a headless / session-0 CI runner — WebView2 fails to initialize
  there (`0x80070578`, invalid window handle), so the injected script never
  ran and the decisive assertion failed for a reason unrelated to the code
  under test.

  `--apply-update` (`crates/native/src/updater.rs`) is reachable before any
  window/webview is created — `run_launcher()` calls
  `maybe_apply_update()` first (`crates/native/src/launcher.rs`) — so
  invoking the installed launcher binary directly with `--apply-update` and
  its argv is fully headless, and reaches the exact same Rust apply code with
  the exact same argv `maybe_spawn_apply_helper` would build in production:

    <ExePath> --apply-update
              --payload   <SetupV2 absolute path>
              --sha256    <hex sha256 of SetupV2>
              --wait-pid  <pid of a process that will exit shortly>
              --target    <InstallDir>
              --relaunch  <ExePath>

  This exercises the sha256 gate, the wait-pid gate, the self-copy +
  re-exec-outside-`--target` hop (`Outcome::ReExeced`), the silent NSIS
  install that follows, and marker-based proof of the swap.

  Honest scope note: this covers §8 (the apply itself) only. It does NOT
  exercise §7's `.murasaki-apply.json` handoff read, nor the
  `appQuit` -> event-loop -> `maybe_spawn_apply_helper` trigger — both need
  the GUI/webview. It also does not empirically exercise the Windows Job
  Object survival property: the helper here is spawned by this script,
  outside of any job. That the launcher spawns the apply-helper outside its
  own `KILL_ON_JOB_CLOSE` job is guaranteed structurally — the launcher
  itself is never assigned to that job, only the node child is (see
  `win_job` and `maybe_spawn_apply_helper` in launcher.rs) — and is covered
  by code review, not by this script.

  Positive case: silently installs v1, invokes `--apply-update` with the
  real v2 sha256, and waits for the v2 marker file (planted by the v2 NSIS
  installer, run silently by the re-exec'd helper) to appear.

  Negative case: same shape, but with a deliberately wrong sha256 — asserts
  the marker never appears and the existing install is left completely
  intact. A corrupt payload must never cost the user their app.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$ProductName,

  [Parameter(Mandatory = $true)]
  [string]$SetupV1,

  [Parameter(Mandatory = $true)]
  [string]$SetupV2,

  # Relative to the install dir — baked into the v2 bundle's `resources\` by
  # the workflow before re-running `murasaki installer` (see
  # app-package-win.yml), purely so this script can tell "v2 was actually
  # applied" apart from "v1 is still installed" (v1 never ships this file).
  [string]$MarkerRelativePath = 'resources\.murasaki-e2e-marker',

  # Generous: covers a silent NSIS install running as part of the apply, on
  # a possibly-loaded CI runner.
  [int]$MarkerTimeoutSeconds = 180,

  # The negative case's failure is near-instant (sha256 verification happens
  # before anything else is touched — see updater.rs's `verify_and_wait`), so
  # this only needs to be generous enough to rule out "just slow", not
  # "never".
  [int]$NegativeMarkerTimeoutSeconds = 45,

  # Falls back to the OS temp dir so this script can also be run manually
  # (e.g. reproducing a CI failure locally) without $env:RUNNER_TEMP set.
  [string]$LogPath = (Join-Path ($(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() })) 'murasaki-updater-e2e.log')
)

$ErrorActionPreference = 'Stop'

foreach ($path in @($SetupV1, $SetupV2)) {
  if (-not (Test-Path $path)) {
    Write-Error "installer not found: $path"
    exit 1
  }
}

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\$ProductName"
$ExePath = Join-Path $InstallDir "$ProductName.exe"
$ResourcesDir = Join-Path $InstallDir 'resources'
$MarkerPath = Join-Path $InstallDir $MarkerRelativePath

# ── small utilities ──────────────────────────────────────────────────────

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

# Sweeps every process (the launcher .exe and resources\node.exe alike)
# still running out of $InstallDir. Covers the app the apply-helper
# relaunched after a successful update — this script never spawned that
# process itself, so a PID-based cleanup can't reach it — plus any leftover
# node.exe, mirroring win-smoke-test.ps1's own doc comment on why Windows
# needs a manual sweep here (no ppid-based orphan self-check like
# prod-server.mjs's POSIX one).
function Stop-InstallDirProcesses {
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
}

# Best-effort clean slate before each phase: kills anything still running
# out of $InstallDir, silently runs the installed Uninstall.exe (NSIS's
# `RMDir /r "$INSTDIR"` — see installer.ts's uninstallSection — wipes
# everything under the install dir, not just originally-installed files, so
# this also clears any leftover marker file from a previous phase), then
# removes anything left behind. A no-op if $InstallDir doesn't exist.
function Uninstall-InstalledApp {
  if (-not (Test-Path $InstallDir)) { return }

  Stop-InstallDirProcesses

  $uninstaller = Join-Path $InstallDir 'Uninstall.exe'
  if (Test-Path $uninstaller) {
    Write-Host "Uninstalling existing install at $InstallDir ..."
    $proc = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait
    if ($proc.ExitCode -ne 0) {
      Write-Host "::warning::Uninstall.exe exited with code $($proc.ExitCode) — falling back to a manual delete."
    }
  }

  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
  }
}

function Install-SetupSilently([string]$SetupPath) {
  Write-Host "Silently installing $SetupPath ..."
  $proc = Start-Process -FilePath $SetupPath -ArgumentList '/S' -PassThru -Wait
  if ($proc.ExitCode -ne 0) {
    Write-Error "Silent install of $SetupPath exited with code $($proc.ExitCode)"
    exit 1
  }
  if (-not (Test-Path $ExePath)) {
    Write-Error "Install did not produce $ExePath"
    exit 1
  }
}

function Wait-Marker([int]$WaitTimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($WaitTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $MarkerPath) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return (Test-Path $MarkerPath)
}

# Invokes the installed launcher's `--apply-update` mode directly, with the
# exact argv `maybe_spawn_apply_helper` (launcher.rs) builds in production.
# Uses `Start-Process -Wait -PassThru` rather than the `&` call operator — a
# `windows_subsystem="windows"` binary is not reliably waited on by `&`.
# $SetupV2/$InstallDir/$ExePath may contain spaces, so each space-containing
# argument is individually wrapped in embedded double quotes.
#
# Redirects the helper's stdout/stderr to files. The re-exec'd copy that does
# the actual install inherits these handles and keeps writing to them after
# this original process has already returned `Outcome::ReExeced`, so the files
# accumulate the WHOLE `murasaki-apply:` diagnostic chain — read them after the
# marker wait resolves (see `Show-ApplyDiagnostics`). On a failure this is the
# difference between a bare "marker never appeared" and seeing exactly where
# the apply stopped (bad sha256, a stuck NSIS install, …), which is the only
# thing a CI log has to go on. Returns the process plus the two log paths.
function Invoke-ApplyUpdate([string]$Sha256, [int]$WaitPid, [string]$Label) {
  $outLog = Join-Path $env:TEMP "murasaki-apply-$Label-out.log"
  $errLog = Join-Path $env:TEMP "murasaki-apply-$Label-err.log"
  $argArray = @(
    '--apply-update',
    '--payload', "`"$SetupV2`"",
    '--sha256', $Sha256,
    '--wait-pid', "$WaitPid",
    '--target', "`"$InstallDir`"",
    '--relaunch', "`"$ExePath`""
  )
  $proc = Start-Process -FilePath $ExePath -ArgumentList $argArray -Wait -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  [PSCustomObject]@{ Process = $proc; OutLog = $outLog; ErrLog = $errLog }
}

# Prints whatever the apply-helper chain wrote. Call it AFTER the marker wait
# resolves, by which point the re-exec'd copy has finished (or timed out) and
# flushed its output. Best-effort reads (`-ErrorAction SilentlyContinue`): the
# relaunched app can still hold the stderr handle open, and a missing/locked
# log must never turn a diagnostic aid into a hard failure.
function Show-ApplyDiagnostics($Apply) {
  Write-Host '--- apply-helper stderr (murasaki-apply: lines) ---'
  Get-Content -Path $Apply.ErrLog -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  Write-Host '--- apply-helper stdout ---'
  Get-Content -Path $Apply.OutLog -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
}

# ── main ──────────────────────────────────────────────────────────────────

$transcriptStarted = $false
try {
  Start-Transcript -Path $LogPath -Force | Out-Null
  $transcriptStarted = $true
} catch {
  Write-Host "Warning: could not start transcript at ${LogPath}: $_"
}

$exitCode = 1
try {
  Write-Host '=== Pre-clean: removing any pre-existing install ==='
  Uninstall-InstalledApp

  # ── Positive case ────────────────────────────────────────────────────
  Write-Host ''
  Write-Host '=== Positive case: v1 -> v2 via --apply-update, invoked directly ==='

  Install-SetupSilently -SetupPath $SetupV1
  if (Test-Path $MarkerPath) {
    Write-Error "unexpected: v2 marker already present after a fresh v1 install ($MarkerPath)"
    exit 1
  }
  Write-Host "v1 installed at $ExePath; v2 marker correctly absent after a fresh v1 install."

  $sha256 = (Get-FileHash -Path $SetupV2 -Algorithm SHA256).Hash.ToLower()
  Write-Host "v2 payload sha256: $sha256"

  # A genuinely short-lived process so the helper exercises the real
  # "wait for the quitting launcher's pid to exit" gate — in production this
  # is the launcher's own pid; here it's this sleeper's.
  $sleeper = Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile', '-Command', 'Start-Sleep -Seconds 4' -PassThru
  Write-Host "wait-pid (sleeper): $($sleeper.Id)"

  $apply = Invoke-ApplyUpdate -Sha256 $sha256 -WaitPid $sleeper.Id -Label 'pos'
  Write-Host "--apply-update exit code: $($apply.Process.ExitCode)"
  # The installed exe lives inside --target, so it self-copies to
  # %TEMP%\murasaki-apply-<pid>.exe, re-execs with --no-self-copy, and
  # returns exit 0 (Outcome::ReExeced) BEFORE the real install happens — the
  # marker is not expected to exist yet at this point.

  $markerAppeared = Wait-Marker -WaitTimeoutSeconds $MarkerTimeoutSeconds
  Show-ApplyDiagnostics $apply
  if (-not $markerAppeared) {
    Write-Error (
      "v2 marker never appeared at $MarkerPath within ${MarkerTimeoutSeconds}s. " +
      'This is the decisive assertion this workflow exists to make: the apply ' +
      'path (contract §8 — sha256 verify, wait-pid gate, self-copy/re-exec, ' +
      'silent NSIS install) did not complete.'
    )
    exit 1
  }
  Write-Host 'v2 marker present — the update was applied for real.'

  if (-not (Test-Path $ExePath)) {
    Write-Error "$ExePath is gone after a successful apply — the app must remain installed/relaunchable."
    exit 1
  }
  Write-Host "$ExePath still present after the apply."
  # Note: confirming the relaunched app actually starts is not reliable
  # headless (it needs a webview), so it is intentionally not asserted here.

  Stop-InstallDirProcesses
  Write-Host 'Positive case PASSED.'

  # ── Negative case ────────────────────────────────────────────────────
  Write-Host ''
  Write-Host '=== Negative case: a corrupt payload must never apply, and must never cost the install ==='

  Uninstall-InstalledApp
  Install-SetupSilently -SetupPath $SetupV1
  if (Test-Path $MarkerPath) {
    Write-Error "unexpected: v2 marker present after a fresh v1 reinstall ($MarkerPath)"
    exit 1
  }

  # Deliberately wrong — a real sha256 is astronomically unlikely to ever be
  # all zeros.
  $badSha256 = '0' * 64

  # verify_sha256 runs before the wait-pid gate (updater.rs's
  # verify_and_wait), so this dummy pid is never actually waited on.
  $applyBad = Invoke-ApplyUpdate -Sha256 $badSha256 -WaitPid 999999 -Label 'neg'
  Write-Host "--apply-update exit code: $($applyBad.Process.ExitCode) (expect non-zero)"
  Show-ApplyDiagnostics $applyBad
  if ($applyBad.Process.ExitCode -eq 0) {
    Write-Error "--apply-update exited 0 despite a deliberately wrong sha256 — the sha256 gate did not fire."
    exit 1
  }

  $markerAppearedBad = Wait-Marker -WaitTimeoutSeconds $NegativeMarkerTimeoutSeconds
  if ($markerAppearedBad) {
    Write-Error "v2 marker appeared at $MarkerPath despite a deliberately wrong sha256 — a corrupt payload must never apply."
    exit 1
  }
  Write-Host 'Marker correctly absent — the sha256 mismatch aborted the apply before touching the install.'

  if (-not (Test-Path $ExePath)) {
    Write-Error "$ExePath is gone after the failed apply — the install must survive a corrupt payload intact."
    exit 1
  }
  $metaPath = Join-Path $ResourcesDir 'murasaki-meta.json'
  if (-not (Test-Path $metaPath)) {
    Write-Error "$metaPath is gone after the failed apply — the install must survive a corrupt payload intact."
    exit 1
  }
  Write-Host 'Install is still intact after the failed apply.'

  Stop-InstallDirProcesses
  Write-Host 'Negative case PASSED.'

  $exitCode = 0
} finally {
  Stop-InstallDirProcesses
  Uninstall-InstalledApp
  Get-ChildItem $env:TEMP -Filter 'murasaki-apply-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
  if ($transcriptStarted) {
    Stop-Transcript | Out-Null
  }
}

exit $exitCode

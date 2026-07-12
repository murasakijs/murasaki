<#
.SYNOPSIS
  End-to-end verifies the Windows auto-updater apply path (the frozen
  updater contract's §7 REVISED / §8) against a REAL installed murasaki app.

.DESCRIPTION
  Why this exists: the apply-helper used to be spawned by Node, which sits
  inside the launcher's `KILL_ON_JOB_CLOSE` Win32 Job Object (`win_job` in
  crates/native/src/launcher.rs). On Windows, a child of a job member is
  auto-assigned to the same job unless spawned with
  `CREATE_BREAKAWAY_FROM_JOB` (which Node's `child_process` has no way to
  request), so the moment the app quit, the OS killed the helper and the
  update silently never applied. The fix — the launcher spawns the helper
  instead of Node, since the launcher itself was never assigned to that job
  — has only ever been verified end-to-end on macOS. This script is what
  turns "should also work on Windows" into observed fact.

  Positive case:
    1. Silently installs the v1 NSIS `-setup.exe`, resolves the (default
       perUser) install dir, and asserts the app landed there with no v2
       marker present yet.
    2. Hand-writes the exact `<resourcesDir>\.murasaki-apply.json` handoff
       `runtime/updater.ts`'s `install()` would have written — `{ payload,
       sha256 }`, the real sha256 of the v2 `-setup.exe` — the only two keys
       `crates/native/src/launcher.rs`'s `ApplyHandoff` deserializes.
    3. Injects a one-shot script into the installed app's own
       `resources\client\index.html` that sends exactly what murasaki's real
       `quit()` sends (`packages/murasaki/src/react/rpc.ts`):
       `window.ipc.postMessage(JSON.stringify({ kind: 'appQuit' }))`. This is
       load-bearing: a forced process kill (`Stop-Process -Force`) never
       reaches `crates/native/src/webview.rs`'s `QUIT_REQUESTED` /
       `maybe_spawn_apply_helper`, so this test would pass vacuously without
       going through the real quit path.
    4. Launches the installed exe and waits for the v2 marker file that only
       `murasaki-launcher --apply-update` (crates/native/src/updater.rs) can
       plant to appear in the install dir. **That single assertion is the
       whole point of this script**: under the old (broken) Node-spawns-the-
       helper design, the Job Object would have killed the helper before it
       could ever get there.
    5. Asserts the handoff file is gone (the launcher deletes it on its way
       out — contract §7 REVISED step 6) and that the app relaunched.

  Negative case: same shape, but with a deliberately wrong sha256 in the
  handoff — asserts the marker never appears and the existing install is
  left completely intact and launchable. A corrupt payload must never cost
  the user their app.

  Reuses win-smoke-test.ps1's patterns: redirected stdout/stderr + the
  `MURASAKI_PORT=<n>` handshake + an HTTP 200 poll to know the app is fully
  up, and its `Stop-ProcessTree`/path-based sweep approach for cleanup.

  Best-effort bonus: `maybe_spawn_apply_helper` and the apply-helper itself
  never redirect their own stdout/stderr, so (assuming ordinary Windows
  handle inheritance holds — exactly the kind of thing this workflow exists
  to observe, not assume) every `murasaki-apply:` diagnostic line the helper
  writes should land on the SAME captured stream as the original launch, with
  no extra plumbing. This script prints that stream in full; it is not
  asserted on.
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

  # Port/HTTP-up wait — same default as win-smoke-test.ps1.
  [int]$TimeoutSeconds = 60,

  # Generous: covers a silent NSIS install running as part of the apply, on
  # a possibly-loaded CI runner.
  [int]$MarkerTimeoutSeconds = 180,

  # The negative case's failure is near-instant (sha256 verification happens
  # before anything else is touched — see updater.rs's `verify_and_wait`), so
  # this only needs to be generous enough to rule out "just slow", not
  # "never".
  [int]$NegativeMarkerTimeoutSeconds = 45,

  [int]$RelaunchTimeoutSeconds = 60,

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
$HandoffPath = Join-Path $ResourcesDir '.murasaki-apply.json'
$MarkerPath = Join-Path $InstallDir $MarkerRelativePath
$IndexHtmlPath = Join-Path $ResourcesDir 'client\index.html'

# ── small utilities ──────────────────────────────────────────────────────

# Writes UTF-8 with NO byte-order mark, regardless of PowerShell version
# quirks around `-Encoding utf8` (which has, at various points, silently
# added a BOM). A BOM at the front of `.murasaki-apply.json` would make
# `serde_json::from_str` in launcher.rs fail to parse it — a self-inflicted
# test bug that has nothing to do with the real regression this script
# exists to catch.
function Set-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
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
# this also clears any leftover handoff/marker file from a previous phase),
# then removes anything left behind. A no-op if $InstallDir doesn't exist.
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

# Injects a one-shot script into the installed app's own
# resources\client\index.html (the Vite build output, copied verbatim by
# bundleWin32 — see cli/bundle.ts) that polls for `window.ipc` (wired up
# synchronously by wry's IPC handler before the page's own scripts run — see
# webview.rs's `with_ipc_handler` — so it should already be present by the
# time this fires) and then sends exactly what murasaki's real `quit()`
# sends: `window.ipc.postMessage(JSON.stringify({ kind: 'appQuit' }))`. This
# reaches the REAL production quit path (webview.rs's `QUIT_REQUESTED`), not
# a forced kill — see this script's header comment for why that distinction
# is the entire point.
#
# Marked with an HTML comment so a second call is a no-op — not expected in
# practice, since every phase reinstalls (and thus gets a pristine
# index.html) before injecting, but cheap insurance against a future caller
# forgetting that.
function Add-QuitScript([string]$Path) {
  if (-not (Test-Path $Path)) {
    Write-Error "index.html not found at $Path"
    exit 1
  }
  $html = Get-Content -Raw -Path $Path
  if ($html.Contains('murasaki-updater-e2e:appQuit')) {
    return
  }

  $script = @'
<!-- murasaki-updater-e2e:appQuit -->
<script>
  (function () {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (window.ipc && typeof window.ipc.postMessage === 'function') {
        clearInterval(timer);
        window.ipc.postMessage(JSON.stringify({ kind: 'appQuit' }));
      } else if (attempts > 100) {
        clearInterval(timer);
      }
    }, 100);
  })();
</script>
'@

  if ($html.Contains('</body>')) {
    $html = $html.Replace('</body>', "$script`n</body>")
  } else {
    $html += "`n$script`n"
  }
  Set-Utf8NoBom -Path $Path -Content $html
  Write-Host "Injected the appQuit script into $Path"
}

# Writes the exact handoff shape `runtime/updater.ts`'s `install()` writes —
# `JSON.stringify({ payload: stagedPath, sha256: stagedSha256 })` — and the
# only two keys `launcher.rs`'s `ApplyHandoff` struct deserializes. Getting
# this exactly right is the difference between testing the real regression
# and failing for an unrelated reason.
function Write-Handoff([string]$PayloadPath, [string]$Sha256) {
  $payloadAbs = (Resolve-Path $PayloadPath).Path
  $json = (@{ payload = $payloadAbs; sha256 = $Sha256 } | ConvertTo-Json -Compress)
  Set-Utf8NoBom -Path $HandoffPath -Content $json
  Write-Host "Wrote handoff: $HandoffPath -> $json"
}

# Launches $ExePath with stdout/stderr redirected — same technique as
# win-smoke-test.ps1 — and waits for the MURASAKI_PORT handshake + an HTTP
# 200, so the caller knows the app (and its embedded node.exe) is fully up
# before whatever the injected quit script does next takes effect.
#
# Unlike win-smoke-test.ps1 (which owns the whole process lifecycle), this
# does NOT kill the process before returning — the caller decides what
# happens next (wait for the quit-triggered marker, or force-kill for a
# plain liveness check).
function Start-InstalledApp([int]$WaitTimeoutSeconds) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ExePath
  $psi.WorkingDirectory = $InstallDir
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi

  $stdout = New-Object System.Text.StringBuilder
  $stderr = New-Object System.Text.StringBuilder

  $outEvent = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
    if ($null -ne $Event.SourceEventArgs.Data) {
      Write-Host "[app] $($Event.SourceEventArgs.Data)"
      [void]$Event.MessageData.AppendLine($Event.SourceEventArgs.Data)
    }
  } -MessageData $stdout

  $errEvent = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
    if ($null -ne $Event.SourceEventArgs.Data) {
      Write-Host "[app:stderr] $($Event.SourceEventArgs.Data)"
      [void]$Event.MessageData.AppendLine($Event.SourceEventArgs.Data)
    }
  } -MessageData $stderr

  Write-Host "Launching $ExePath ..."
  [void]$proc.Start()
  $proc.BeginOutputReadLine()
  $proc.BeginErrorReadLine()

  $deadline = (Get-Date).AddSeconds($WaitTimeoutSeconds)

  # Phase 1: wait for the relayed "MURASAKI_PORT=<n>" line.
  $port = $null
  while (-not $port -and (Get-Date) -lt $deadline) {
    if ($stdout.ToString() -match 'MURASAKI_PORT=(\d+)') {
      $port = [int]$Matches[1]
      break
    }
    if ($proc.HasExited) {
      Unregister-Event -SourceIdentifier $outEvent.Name -ErrorAction SilentlyContinue
      Unregister-Event -SourceIdentifier $errEvent.Name -ErrorAction SilentlyContinue
      Write-Error "$ExePath exited early (code $($proc.ExitCode)) before reporting a port."
      exit 1
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $port) {
    Write-Error "Timed out after ${WaitTimeoutSeconds}s waiting for MURASAKI_PORT."
    exit 1
  }

  # Phase 2: poll the backend for an HTTP 200 — proves prod-server.mjs is
  # actually serving, not just that node started.
  Write-Host "Backend reported port $port — polling http://127.0.0.1:$port/ ..."
  $ok = $false
  while (-not $ok -and (Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -eq 200) { $ok = $true; break }
    } catch {
      # Not up yet (or crashed after printing the port) — keep polling.
    }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ok) {
    Write-Error "Never got HTTP 200 from 127.0.0.1:$port within the timeout."
    exit 1
  }
  Write-Host 'Got HTTP 200 from the installed app.'

  [PSCustomObject]@{
    Process      = $proc
    Stdout       = $stdout
    Stderr       = $stderr
    Port         = $port
    OutEventName = $outEvent.Name
    ErrEventName = $errEvent.Name
  }
}

# Unregisters a session's output/error event subscriptions and force-kills
# its process tree if it's still running (a clean quit exits it on its own;
# this is the fallback for the negative case, where nothing relaunches it).
function Stop-AppSession($Session) {
  if ($null -eq $Session) { return }
  Unregister-Event -SourceIdentifier $Session.OutEventName -ErrorAction SilentlyContinue
  Unregister-Event -SourceIdentifier $Session.ErrEventName -ErrorAction SilentlyContinue
  if (-not $Session.Process.HasExited) {
    Stop-ProcessTree -RootId $Session.Process.Id
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

# Looks for a NEW process running $ExePath (a different pid from the one
# that just quit) — the apply-helper's relaunch step (updater.rs's
# `relaunch()`) spawns exactly this.
function Wait-Relaunch([int]$OriginalPid, [int]$WaitTimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($WaitTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $found = Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $ExePath -and $_.Id -ne $OriginalPid }
    if ($found) { return @($found)[0] }
    Start-Sleep -Milliseconds 500
  }
  return $null
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
  Write-Host '=== Positive case: v1 -> v2 via the real quit -> apply -> relaunch path ==='

  Install-SetupSilently -SetupPath $SetupV1
  if (Test-Path $MarkerPath) {
    Write-Error "unexpected: v2 marker already present after a fresh v1 install ($MarkerPath)"
    exit 1
  }
  Write-Host "v1 installed at $ExePath; v2 marker correctly absent."

  $sha256 = (Get-FileHash -Path $SetupV2 -Algorithm SHA256).Hash.ToLower()
  Write-Host "v2 payload sha256: $sha256"

  Write-Handoff -PayloadPath $SetupV2 -Sha256 $sha256
  Add-QuitScript -Path $IndexHtmlPath

  $session = Start-InstalledApp -WaitTimeoutSeconds $TimeoutSeconds
  $originalPid = $session.Process.Id
  Write-Host "App is up (pid $originalPid); waiting for its injected script to fire the real appQuit path..."

  try {
    $markerAppeared = Wait-Marker -WaitTimeoutSeconds $MarkerTimeoutSeconds
  } finally {
    Stop-AppSession -Session $session
  }

  if (-not $markerAppeared) {
    Write-Error (
      "v2 marker never appeared at $MarkerPath within ${MarkerTimeoutSeconds}s. " +
      'This is the decisive assertion this workflow exists to make: if the apply-helper ' +
      "was killed by the launcher's Job Object before it could apply the update (the " +
      'exact Windows-specific bug the "launcher spawns the helper, not Node" fix — contract ' +
      '§7 REVISED — addresses), this is what it looks like.'
    )
    exit 1
  }
  Write-Host 'v2 marker present — the update was applied for real.'

  if (Test-Path $HandoffPath) {
    Write-Error "handoff file $HandoffPath is still present — the launcher should have deleted it on its way out (contract §7 REVISED step 6)."
    exit 1
  }
  Write-Host 'Handoff file correctly deleted by the launcher.'

  $relaunched = Wait-Relaunch -OriginalPid $originalPid -WaitTimeoutSeconds $RelaunchTimeoutSeconds
  if (-not $relaunched) {
    Write-Error "no relaunched $ExePath process was found within ${RelaunchTimeoutSeconds}s after the update applied."
    exit 1
  }
  Write-Host "App relaunched: pid $($relaunched.Id)."

  Write-Host '--- full stdout (original process; may include the apply-helper''s inherited output — see this script''s header comment) ---'
  Write-Host $session.Stdout.ToString()
  Write-Host '--- full stderr (original process; look for murasaki-apply: lines) ---'
  Write-Host $session.Stderr.ToString()

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
  Write-Handoff -PayloadPath $SetupV2 -Sha256 $badSha256
  Add-QuitScript -Path $IndexHtmlPath

  $session2 = Start-InstalledApp -WaitTimeoutSeconds $TimeoutSeconds
  Write-Host "App is up (pid $($session2.Process.Id)); waiting to confirm the marker does NOT appear..."

  try {
    $markerAppearedBad = Wait-Marker -WaitTimeoutSeconds $NegativeMarkerTimeoutSeconds
  } finally {
    Stop-AppSession -Session $session2
  }

  if ($markerAppearedBad) {
    Write-Error "v2 marker appeared at $MarkerPath despite a deliberately wrong sha256 — a corrupt payload must never apply."
    exit 1
  }
  Write-Host 'Marker correctly absent — the sha256 mismatch aborted the apply before touching the install.'

  if (Test-Path $HandoffPath) {
    Write-Error "handoff file $HandoffPath is still present after the failed apply — the launcher should still delete it on its way out."
    exit 1
  }

  if (-not (Test-Path $ExePath)) {
    Write-Error "$ExePath is gone after the failed apply — the install must survive a corrupt payload intact."
    exit 1
  }

  Write-Host 'Confirming the install is still launchable after the failed apply...'
  Stop-InstallDirProcesses
  $sanitySession = Start-InstalledApp -WaitTimeoutSeconds $TimeoutSeconds
  Stop-AppSession -Session $sanitySession
  Write-Host 'Install is still intact and launchable.'

  Write-Host '--- full stderr (negative-case original process) ---'
  Write-Host $session2.Stderr.ToString()

  Stop-InstallDirProcesses
  Write-Host 'Negative case PASSED.'

  $exitCode = 0
} finally {
  Stop-InstallDirProcesses
  Uninstall-InstalledApp
  if ($transcriptStarted) {
    Stop-Transcript | Out-Null
  }
}

exit $exitCode

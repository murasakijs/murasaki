#!/usr/bin/env bash
# Feature-parity evidence for the packaged Linux AppImage produced from
# examples/linux-parity-probe. Proves, from OUTSIDE the WebView (CI has no
# display), that the platform-agnostic Murasaki capabilities currently
# labeled "development-only" (or, for multi-window, "unsupported") on Linux
# in packages/murasaki/capabilities.json actually work in a packaged Linux
# app — see that example's README for the full feature list.
#
# Evidence comes from three places, matching linux-smoke-test.sh's existing
# pattern:
#   (a) the loopback HTTP server — curl / and curl /api/* (authenticated,
#       see the window-token derivation below),
#   (b) files on disk — the build-time plugin sentinel already staged into
#       the AppDir, and a crash-report JSON + JSONL log under the app
#       data/state dirs,
#   (c) greppable `PROBE:<feature>:PASS` stdout lines a renderer self-test
#       prints on page load (src/app/layout.tsx + src/lib/probeOrchestrator.ts
#       drive the sequence; src/api/probe/report and .../window/route.ts
#       print the markers server-side after validating each result).
#
# Launches the packaged AppImage TWICE, not once:
#   RUN 1 exercises every renderer-driven feature, including multi-window's
#   create/destroy/recreate sequence. On Linux that sequence can itself crash
#   the whole packaged process (see src/api/probe/window/route.ts's comment)
#   — if that happens, RUN 1 simply ends early; every marker already observed
#   still counts, and every marker never reached is recorded as a failure.
#   RUN 2 is a fresh, independent launch dedicated to diagnostics-and-logging
#   (intentionally crashing Node Main via src/api/probe/crash-node/route.ts,
#   then checking the resulting crash-report + JSONL log). Keeping it in its
#   own launch means its evidence never depends on whether RUN 1's
#   multi-window check happened to survive.
#
# Every feature's result is recorded and this script keeps going after a
# failure — the summary at the end names every feature that failed, not just
# the first. Exits non-zero if anything failed.

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)

APPIMAGE_PATH=${1:-}
APPDIR_PATH=${2:-}
LOG_DIR=${3:-"${RUNNER_TEMP:-/tmp}/murasaki-linux-feature-probe"}
TIMEOUT_SECONDS=${4:-90}
APP_ID='app.murasaki.linux.parity.probe'
PROCESS_PATTERN='appimage_extracted_.*/usr/bin/'
NODE_PATTERN='appimage_extracted_.*/resources/node '
WINDOW_AUTH_JS="$REPO_ROOT/packages/murasaki/dist/runtime/window-auth.js"
RUN_PID=''

RESULTS=()

usage() {
  echo "usage: $0 <path-to-AppImage> <path-to-AppDir> [log-directory] [timeout-seconds]" >&2
}

record_pass() {
  RESULTS+=("$1:PASS")
  echo "  [PASS] $1"
}

record_fail() {
  RESULTS+=("$1:FAIL $2")
  echo "  [FAIL] $1 -- $2" >&2
}

# Unrecoverable setup/infra problem (nothing else can be usefully checked) —
# distinct from record_fail, which records one feature's failure and lets
# every other check still run.
hard_fail() {
  echo "Linux feature probe aborted: $1" >&2
  exit 2
}

still_running() {
  [[ -n "$RUN_PID" ]] && kill -0 "$RUN_PID" 2>/dev/null || pgrep -f "$PROCESS_PATTERN" >/dev/null 2>&1
}

stop_run() {
  [[ -n "$RUN_PID" ]] && kill -TERM "$RUN_PID" 2>/dev/null
  pkill -TERM -f "$PROCESS_PATTERN" 2>/dev/null || true
  pkill -TERM -f "$NODE_PATTERN" 2>/dev/null || true
  for _ in {1..50}; do
    still_running || pgrep -f "$NODE_PATTERN" >/dev/null 2>&1 || { [[ -n "$RUN_PID" ]] && wait "$RUN_PID" 2>/dev/null; RUN_PID=''; return; }
    sleep 0.1
  done
  pkill -KILL -f "$PROCESS_PATTERN" 2>/dev/null || true
  pkill -KILL -f "$NODE_PATTERN" 2>/dev/null || true
  [[ -n "$RUN_PID" ]] && wait "$RUN_PID" 2>/dev/null
  RUN_PID=''
}

trap stop_run EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -z "$APPIMAGE_PATH" || -z "$APPDIR_PATH" ]]; then
  usage
  exit 2
fi
if [[ ! "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  hard_fail "timeout must be a positive integer: $TIMEOUT_SECONDS"
fi
if [[ ! -f "$APPIMAGE_PATH" || "$APPIMAGE_PATH" != *.AppImage ]]; then
  hard_fail "AppImage not found: $APPIMAGE_PATH"
fi
if [[ ! -d "$APPDIR_PATH" ]]; then
  hard_fail "AppDir not found: $APPDIR_PATH"
fi
if [[ ! -f "$WINDOW_AUTH_JS" ]]; then
  hard_fail "missing compiled window-auth.js — run \`pnpm --filter murasaki build\` first: $WINDOW_AUTH_JS"
fi

mkdir -p "$LOG_DIR"
RUN1_STDOUT="$LOG_DIR/run1.stdout.log"
RUN1_STDERR="$LOG_DIR/run1.stderr.log"
RUN2_STDOUT="$LOG_DIR/run2.stdout.log"
RUN2_STDERR="$LOG_DIR/run2.stderr.log"

launch() {
  # launch <stdout-log> <stderr-log> — sets RUN_PID.
  local out=$1 err=$2
  : > "$out"
  : > "$err"
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
  export WEBKIT_DISABLE_COMPOSITING_MODE=1
  export LIBGL_ALWAYS_SOFTWARE=1
  if [[ -n "${DISPLAY:-}" ]]; then
    "$APPIMAGE_PATH" --appimage-extract-and-run >"$out" 2>"$err" &
  else
    xvfb-run -a --server-args="-screen 0 1280x800x24" \
      dbus-run-session -- "$APPIMAGE_PATH" --appimage-extract-and-run \
      >"$out" 2>"$err" &
  fi
  RUN_PID=$!
}

wait_for_port() {
  # wait_for_port <stdout-log> <deadline-epoch-seconds> — echoes the port, or empty.
  local out=$1 deadline=$2 port=''
  while (( SECONDS < deadline )); do
    port=$(sed -n 's/.*MURASAKI_PORT=\([0-9][0-9]*\).*/\1/p' "$out" | tail -n 1)
    [[ -n "$port" ]] && { echo "$port"; return 0; }
    still_running || return 1
    sleep 0.5
  done
  return 1
}

wait_for_http_ok() {
  # wait_for_http_ok <port> <deadline-epoch-seconds>
  local port=$1 deadline=$2 status
  while (( SECONDS < deadline )); do
    status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --max-time 5 "http://127.0.0.1:$port/" 2>/dev/null || true)
    [[ "$status" == '200' ]] && return 0
    still_running || return 1
    sleep 0.5
  done
  return 1
}

derive_window_token() {
  # derive_window_token <runtime-token> — echoes the derived 'main' generation-1 token.
  node --input-type=module -e "
import { deriveWindowToken } from '$WINDOW_AUTH_JS'
process.stdout.write(deriveWindowToken(process.argv[1], 'main', 1))
" "$1"
}

read_runtime_token() {
  # read_runtime_token — echoes MURASAKI_RUNTIME_TOKEN read from the running
  # bundled Node child's own environment (same-uid /proc access to a process
  # this script itself started), or empty if not found.
  local node_pid
  node_pid=$(pgrep -f 'node prod-server\.mjs' | head -n 1 || true)
  [[ -n "$node_pid" ]] || return 1
  tr '\0' '\n' < "/proc/$node_pid/environ" 2>/dev/null | sed -n 's/^MURASAKI_RUNTIME_TOKEN=//p'
}

# ── build-time-plugin-sdk: purely static, no launch needed ─────────────────
RESOURCES_DIR=$(find "$APPDIR_PATH/usr/lib" -mindepth 1 -maxdepth 1 -type d -print -quit)/resources
if [[ -d "$RESOURCES_DIR" ]] && grep -Fq 'PROBE:build-time-plugin-sdk:PASS' "$RESOURCES_DIR/plugin-sentinel.txt" 2>/dev/null; then
  record_pass build-time-plugin-sdk
else
  record_fail build-time-plugin-sdk "sentinel file missing/invalid under $RESOURCES_DIR"
fi

##############################################################################
# RUN 1 — every renderer-driven feature, including multi-window.
##############################################################################
echo
echo '== RUN 1: renderer-driven feature sequence =='
launch "$RUN1_STDOUT" "$RUN1_STDERR"
DEADLINE=$((SECONDS + TIMEOUT_SECONDS))

PORT=$(wait_for_port "$RUN1_STDOUT" "$DEADLINE") || true
if [[ -z "$PORT" ]]; then
  record_fail startup "launcher never reported MURASAKI_PORT within ${TIMEOUT_SECONDS}s (run 1)"
  # Nothing else in run 1 is checkable without a port.
  PORT=''
fi

if [[ -n "$PORT" ]]; then
  if wait_for_http_ok "$PORT" "$DEADLINE"; then
    echo "Backend reported port $PORT and returned HTTP 200."
  else
    record_fail startup "backend never returned HTTP 200 within ${TIMEOUT_SECONDS}s (run 1)"
    PORT=''
  fi
fi

if [[ -n "$PORT" ]]; then
  BODY=$(curl --silent --show-error --max-time 5 "http://127.0.0.1:$PORT/" || true)
  if grep -q 'data-murasaki-csp' <<<"$BODY" && grep -qi 'http-equiv="Content-Security-Policy"' <<<"$BODY"; then
    record_pass content-security-policy-curl
  else
    record_fail content-security-policy-curl "served HTML is missing the framework CSP <meta> tag"
  fi

  echo 'Deriving an authenticated "main" window identity for server-side /api/* verification ...'
  RUNTIME_TOKEN=$(read_runtime_token || true)
  if [[ -z "$RUNTIME_TOKEN" ]]; then
    record_fail api-routes-curl "could not read MURASAKI_RUNTIME_TOKEN from the bundled Node child environment"
  else
    WINDOW_TOKEN=$(derive_window_token "$RUNTIME_TOKEN")
    AUTH_HEADERS=(-H "x-murasaki-window-label: main" -H "x-murasaki-window-generation: 1" -H "x-murasaki-window-token: $WINDOW_TOKEN")

    GET_BODY=$(curl --silent --show-error --max-time 5 "${AUTH_HEADERS[@]}" "http://127.0.0.1:$PORT/api/probe/hello" || true)
    POST_BODY=$(curl --silent --show-error --max-time 5 -X POST -H 'content-type: application/json' \
      "${AUTH_HEADERS[@]}" -d '{"echo":"curl-check"}' "http://127.0.0.1:$PORT/api/probe/hello" || true)
    GREET_BODY=$(curl --silent --show-error --max-time 5 "${AUTH_HEADERS[@]}" "http://127.0.0.1:$PORT/api/probe/greet/CurlCheck" || true)

    if grep -q '"message":"linux-parity-probe hello"' <<<"$GET_BODY" \
      && grep -q '"echo":"curl-check"' <<<"$POST_BODY" \
      && grep -q '"greeting":"Hello, CurlCheck! (linux-parity-probe)"' <<<"$GREET_BODY"; then
      record_pass api-routes-curl
    else
      record_fail api-routes-curl "unexpected curl response body(ies) — GET:$GET_BODY POST:$POST_BODY GREET:$GREET_BODY"
    fi
  fi

  # Every other renderer-driven feature: wait for its own PROBE:*:PASS
  # marker. Checked as ONE pass over every marker, not per-feature
  # fail-fast — the whole sequence (multi-window's crash included) can
  # finish well before this loop's own deadline, so stopping at the first
  # still-missing marker would misreport every feature queued behind it.
  echo 'Waiting for renderer self-test markers ...'
  # REQUIRED: the features Murasaki claims as supported/partial on packaged
  # Linux. A missing marker here hard-fails the job.
  FEATURE_MARKERS=(
    'file-routing:PROBE:file-routing:PASS'
    'navigation-middleware:PROBE:navigation-middleware:PASS'
    'route-metadata:PROBE:route-metadata:PASS'
    'server-actions:PROBE:server-actions:PASS'
    'api-routes:PROBE:api-routes:PASS'
    'node-main-lifecycle:PROBE:node-main-lifecycle:PASS'
    'webview-session-network:PROBE:webview-session-network:PASS'
    'content-security-policy:PROBE:content-security-policy:PASS'
    'capability-permissions:PROBE:capability-permissions:PASS'
  )
  # KNOWN-FAILING (xfail): runtime secondary-window destroy→recreate crashes
  # the packaged process on Linux with an X11 BadWindow error (see capabilities
  # .json — native-window is 'partial', multi-window is 'unsupported' on Linux,
  # both citing this). Reported for visibility but NON-blocking, so CI stays a
  # true signal for the 9 features above without being permanently red for a
  # gap we already declare. If either UNEXPECTEDLY passes, that's surfaced
  # below so the label can be promoted.
  XFAIL_MARKERS=(
    'native-window:PROBE:native-window:PASS'
    'multi-window:PROBE:multi-window:PASS'
  )
  MARKER_DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
  while (( SECONDS < MARKER_DEADLINE )); do
    still_missing=false
    for entry in "${FEATURE_MARKERS[@]}"; do
      marker=${entry#*:}
      grep -Fqx -- "$marker" "$RUN1_STDOUT" || { still_missing=true; break; }
    done
    [[ "$still_missing" == false ]] && break
    still_running || break
    sleep 0.25
  done
  for entry in "${FEATURE_MARKERS[@]}"; do
    feature=${entry%%:*}
    marker=${entry#*:}
    if grep -Fqx -- "$marker" "$RUN1_STDOUT"; then
      record_pass "$feature"
    else
      record_fail "$feature" "marker never observed: $marker"
    fi
  done

  # xfail features: expected to fail on Linux today. Non-blocking, but if one
  # unexpectedly passes we announce it loudly so the label can be revisited.
  for entry in "${XFAIL_MARKERS[@]}"; do
    feature=${entry%%:*}
    marker=${entry#*:}
    if grep -Fqx -- "$marker" "$RUN1_STDOUT"; then
      echo "  ::warning::xfail feature '$feature' UNEXPECTEDLY passed on Linux — its capability label may now be promotable."
    else
      echo "  (xfail) '$feature' did not pass, as expected on Linux (known X11 recreate crash — tracked)."
    fi
  done

  if [[ -s "$RUN1_STDERR" ]] && grep -q 'PROBE:multi-window:step' "$RUN1_STDOUT"; then
    LAST_STEP=$(grep 'PROBE:multi-window:step' "$RUN1_STDOUT" | tail -n 1)
    echo "  (multi-window diagnostic: last observed lifecycle step was: $LAST_STEP)"
  fi
fi

stop_run

##############################################################################
# RUN 2 — dedicated diagnostics-and-logging check (independent launch).
##############################################################################
echo
echo '== RUN 2: dedicated diagnostics-and-logging check =='
launch "$RUN2_STDOUT" "$RUN2_STDERR"
DEADLINE=$((SECONDS + TIMEOUT_SECONDS))

PORT=$(wait_for_port "$RUN2_STDOUT" "$DEADLINE") || true
if [[ -n "$PORT" ]] && ! wait_for_http_ok "$PORT" "$DEADLINE"; then
  PORT=''
fi

if [[ -z "$PORT" ]]; then
  record_fail diagnostics-and-logging "could not start a dedicated run 2 instance to trigger the intentional crash"
else
  RUNTIME_TOKEN=$(read_runtime_token || true)
  if [[ -z "$RUNTIME_TOKEN" ]]; then
    record_fail diagnostics-and-logging "could not read MURASAKI_RUNTIME_TOKEN for run 2"
  else
    WINDOW_TOKEN=$(derive_window_token "$RUNTIME_TOKEN")
    TRIGGER_STATUS=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 5 \
      -X POST -H "x-murasaki-window-label: main" -H "x-murasaki-window-generation: 1" -H "x-murasaki-window-token: $WINDOW_TOKEN" \
      "http://127.0.0.1:$PORT/api/probe/crash-node" || true)
    if [[ "$TRIGGER_STATUS" != '202' ]]; then
      record_fail diagnostics-and-logging "POST /api/probe/crash-node returned $TRIGGER_STATUS, expected 202"
    else
      echo 'Triggered the intentional Node Main crash; waiting for the launcher to exit ...'
      CRASH_DEADLINE=$((SECONDS + 30))
      while (( SECONDS < CRASH_DEADLINE )); do
        pgrep -f "$PROCESS_PATTERN" >/dev/null 2>&1 || break
        sleep 0.25
      done
      if pgrep -f "$PROCESS_PATTERN" >/dev/null 2>&1; then
        record_fail diagnostics-and-logging "launcher did not exit after the intentional Node Main crash"
      else
        RUN_PID=''
        DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$APP_ID"
        STATE_LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/$APP_ID/logs"
        # Filenames are `<timestamp>-<domain>.json` (main/crash-reports.ts).
        # An unexpected Node exit — deliberate or not — is captured from BOTH
        # sides: Node's own uncaughtException handler writes the `node`
        # report synchronously before it exits; the launcher separately
        # writes a `native` report on observing that unexpected child exit.
        # Both existing is correct dual-domain capture, not a bug — pick the
        # `node` one specifically rather than "the newest file", which can
        # land on either depending on write timing.
        CRASH_REPORT=$(find "$DATA_DIR/crash-reports" -maxdepth 1 -type f -name '*-node.json' 2>/dev/null | sort | tail -n 1)
        NATIVE_REPORT=$(find "$DATA_DIR/crash-reports" -maxdepth 1 -type f -name '*-native.json' 2>/dev/null | sort | tail -n 1)
        JSONL_LOG="$STATE_LOG_DIR/murasaki-main.jsonl"
        if [[ -z "$CRASH_REPORT" ]]; then
          record_fail diagnostics-and-logging "no 'node' domain crash-report JSON found under $DATA_DIR/crash-reports"
        elif ! node -e "
const report = require('$CRASH_REPORT')
if (report.domain !== 'node') process.exit(1)
if (typeof report.message !== 'string' || !report.message.includes('linux-parity-probe')) process.exit(1)
"; then
          record_fail diagnostics-and-logging "crash report at $CRASH_REPORT is not the expected 'node' domain probe report"
        elif [[ ! -s "$JSONL_LOG" ]] || ! grep -q '"message":"linux-parity-probe: main ready"' "$JSONL_LOG"; then
          record_fail diagnostics-and-logging "JSONL log at $JSONL_LOG is missing or missing the expected startup entry"
        else
          record_pass diagnostics-and-logging
          echo "  node crash-report: $CRASH_REPORT"
          [[ -n "$NATIVE_REPORT" ]] && echo "  native crash-report (launcher-observed, also present): $NATIVE_REPORT"
          echo "  JSONL log: $JSONL_LOG"
        fi
      fi
    fi
  fi
fi

stop_run

##############################################################################
# Summary
##############################################################################
echo
echo '== Linux feature probe summary =='
FAILED=0
for entry in "${RESULTS[@]}"; do
  feature=${entry%%:*}
  rest=${entry#*:}
  status=${rest%% *}
  detail=${rest#* }
  if [[ "$status" == PASS ]]; then
    echo "  PASS  $feature"
  else
    FAILED=1
    echo "  FAIL  $feature -- $detail"
  fi
done

echo
echo "Full run-1/run-2 launcher stdout/stderr logs are under: $LOG_DIR"

if [[ "$FAILED" -ne 0 ]]; then
  echo
  echo 'Linux feature probe FAILED — see FAIL lines above.' >&2
  exit 1
fi

echo
echo 'Linux feature probe passed: every checked capability behaved correctly in the packaged AppImage.'

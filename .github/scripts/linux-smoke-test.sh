#!/usr/bin/env bash
# Smoke-test a packaged Murasaki Linux AppImage. Launched via
# `--appimage-extract-and-run` (not a real FUSE mount) since hosted CI
# runners don't reliably have a working `/dev/fuse` — see the distribution
# guide's FUSE note. Runs under `xvfb-run` (no real display on CI) and a
# private D-Bus session bus (secret-service/AppIndicator expect one).
# Mirrors mac-smoke-test.sh's shape/flags: passing `true` as the fifth
# argument kills the bundled Node child and proves the host closes instead of
# leaving a dead WebView behind.
#
# Liveness note: `--appimage-extract-and-run`'s own wrapper process extracts
# then forks the real launcher and can exit on its own almost immediately —
# well before the launcher does — reparenting the real process tree to
# init. So the backgrounded job's own pid (`$APP_PID`) is NOT a reliable
# "is it still running" signal once past the initial extraction window, and
# its exit status is the *wrapper's*, not the launcher's. This script
# therefore treats "does the reported port still answer" as the liveness
# signal once one is known, and matches the real, possibly-reparented
# process tree by its extraction path pattern (unique to this run) for
# anything a port check can't observe (startup failures, and the crash-
# supervision check below, where the port is expected to stop answering
# either way).

set -euo pipefail

APPIMAGE_PATH=${1:-}
LOG_DIR=${2:-"${RUNNER_TEMP:-/tmp}/murasaki-linux-smoke"}
TIMEOUT_SECONDS=${3:-60}
EXPECTED_MARKER=${4:-}
EXPECT_BACKEND_CRASH=${5:-false}
APP_PID=''
STDOUT_LOG="$LOG_DIR/launcher.stdout.log"
STDERR_LOG="$LOG_DIR/launcher.stderr.log"
PROCESS_PATTERN='appimage_extracted_.*/usr/bin/'
# The launcher installs no SIGTERM handler of its own (its graceful-shutdown
# path is driven by window-close/quit IPC, not OS signals — see
# launcher.rs), and `spawn_prod_server` puts the bundled Node child in its
# OWN process group (see that function's doc comment), so signaling only the
# launcher leaves Node — still holding the app's stable port — orphaned.
NODE_PATTERN='appimage_extracted_.*/resources/node '

usage() {
  echo "usage: $0 <path-to-AppImage> [log-directory] [timeout-seconds] [expected-marker] [expect-backend-crash]" >&2
}

dump_logs() {
  if [[ -s "$STDOUT_LOG" ]]; then
    echo '--- launcher stdout ---' >&2
    cat "$STDOUT_LOG" >&2
  fi
  if [[ -s "$STDERR_LOG" ]]; then
    echo '--- launcher stderr ---' >&2
    cat "$STDERR_LOG" >&2
  fi
}

# True while either the backgrounded wrapper or the (possibly reparented)
# real launcher process is still around — see the module doc comment above.
still_running() {
  kill -0 "$APP_PID" 2>/dev/null || pgrep -f "$PROCESS_PATTERN" >/dev/null 2>&1
}

cleanup() {
  if [[ -z "$APP_PID" ]]; then
    return
  fi
  kill -TERM "$APP_PID" 2>/dev/null || true
  pkill -TERM -f "$PROCESS_PATTERN" 2>/dev/null || true
  pkill -TERM -f "$NODE_PATTERN" 2>/dev/null || true
  for _ in {1..50}; do
    still_running || pgrep -f "$NODE_PATTERN" >/dev/null 2>&1 || { wait "$APP_PID" 2>/dev/null || true; return; }
    sleep 0.1
  done
  kill -KILL "$APP_PID" 2>/dev/null || true
  pkill -KILL -f "$PROCESS_PATTERN" 2>/dev/null || true
  pkill -KILL -f "$NODE_PATTERN" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
}

fail() {
  echo "Linux AppImage smoke test failed: $1" >&2
  dump_logs
  exit 1
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -z "$APPIMAGE_PATH" ]]; then
  usage
  exit 2
fi
if [[ ! "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  fail "timeout must be a positive integer: $TIMEOUT_SECONDS"
fi
if [[ ! -f "$APPIMAGE_PATH" || "$APPIMAGE_PATH" != *.AppImage ]]; then
  fail "AppImage not found: $APPIMAGE_PATH"
fi

mkdir -p "$LOG_DIR"
: > "$STDOUT_LOG"
: > "$STDERR_LOG"

echo "Launching $APPIMAGE_PATH (--appimage-extract-and-run) ..."
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1
if [[ -n "${DISPLAY:-}" ]]; then
  # A caller (e.g. linux-installer-e2e.sh, whose own --apply-update-spawned
  # relaunches need the same live display for their whole run) already set
  # up a display + session bus — reuse it instead of nesting a second Xvfb.
  "$APPIMAGE_PATH" --appimage-extract-and-run \
    >"$STDOUT_LOG" 2>"$STDERR_LOG" &
else
  xvfb-run -a --server-args="-screen 0 1280x800x24" \
    dbus-run-session -- "$APPIMAGE_PATH" --appimage-extract-and-run \
    >"$STDOUT_LOG" 2>"$STDERR_LOG" &
fi
APP_PID=$!

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
PORT=''
while (( SECONDS < DEADLINE )); do
  PORT=$(sed -n 's/.*MURASAKI_PORT=\([0-9][0-9]*\).*/\1/p' "$STDOUT_LOG" | tail -n 1)
  if [[ -n "$PORT" ]]; then
    break
  fi
  if ! still_running; then
    fail 'launcher exited before reporting MURASAKI_PORT'
  fi
  sleep 0.5
done

if [[ -z "$PORT" ]]; then
  fail "timed out after ${TIMEOUT_SECONDS}s waiting for MURASAKI_PORT"
fi

echo "Backend reported port $PORT; polling http://127.0.0.1:$PORT/ ..."
HTTP_OK=false
while (( SECONDS < DEADLINE )); do
  STATUS=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 5 "http://127.0.0.1:$PORT/" 2>/dev/null || true)
  if [[ "$STATUS" == '200' ]]; then
    HTTP_OK=true
    break
  fi
  if ! still_running; then
    fail 'launcher exited before the backend returned HTTP 200'
  fi
  sleep 0.5
done

if [[ "$HTTP_OK" != true ]]; then
  fail "backend did not return HTTP 200 within ${TIMEOUT_SECONDS}s"
fi

echo 'Backend returned HTTP 200.'

if [[ -n "$EXPECTED_MARKER" ]]; then
  echo "Waiting for renderer probe marker: $EXPECTED_MARKER"
  MARKER_OK=false
  while (( SECONDS < DEADLINE )); do
    if grep -Fqx -- "$EXPECTED_MARKER" "$STDOUT_LOG"; then
      MARKER_OK=true
      break
    fi
    if ! still_running; then
      fail 'launcher exited before the renderer probe completed'
    fi
    sleep 0.25
  done

  if [[ "$MARKER_OK" != true ]]; then
    fail "renderer probe did not report the expected marker within ${TIMEOUT_SECONDS}s: $EXPECTED_MARKER"
  fi
  echo 'Renderer probe passed.'
fi

sleep 2
STATUS=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/" 2>/dev/null || true)
if [[ "$STATUS" != '200' ]]; then
  fail 'backend stopped responding shortly after becoming ready'
fi

if [[ "$EXPECT_BACKEND_CRASH" == true ]]; then
  # The launcher's own process group holds the bundled Node child (and any
  # descendants) — see launcher.rs's shared::spawn_prod_server/
  # terminate_and_wait_child doc comments for why Linux uses the same
  # process-group approach as macOS.
  NODE_PID=$(pgrep -f 'node prod-server\.mjs' | head -n 1 || true)
  if [[ -z "$NODE_PID" ]]; then
    fail 'could not find the bundled Node child for crash supervision test'
  fi
  echo "Killing bundled Node child $NODE_PID to verify host supervision ..."
  kill -KILL "$NODE_PID"
  CRASH_DEADLINE=$((SECONDS + 10))
  while (( SECONDS < CRASH_DEADLINE )); do
    pgrep -f "$PROCESS_PATTERN" >/dev/null 2>&1 || break
    sleep 0.1
  done
  if pgrep -f "$PROCESS_PATTERN" >/dev/null 2>&1; then
    fail 'launcher left a dead UI running after the bundled Node child exited'
  fi
  echo 'Unexpected bundled Node exit closed the whole launcher process tree.'
  APP_PID=''
else
  echo 'Launcher is still running; Linux AppImage smoke test passed.'
fi

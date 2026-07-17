#!/usr/bin/env bash
# Smoke-test a packaged Murasaki macOS application without signing or
# notarization. The bundle executable is launched directly, which avoids
# Gatekeeper while exercising the same launcher and embedded production server
# that users run after installation. Passing `true` as the fifth argument also
# kills the bundled Node child and proves the host closes instead of leaving a
# dead WebView behind.

set -euo pipefail

APP_PATH=${1:-}
LOG_DIR=${2:-"${RUNNER_TEMP:-/tmp}/murasaki-mac-smoke"}
TIMEOUT_SECONDS=${3:-60}
EXPECTED_MARKER=${4:-}
EXPECT_BACKEND_CRASH=${5:-false}
LAUNCHER_PID=''
TREE_PIDS=()
STDOUT_LOG="$LOG_DIR/launcher.stdout.log"
STDERR_LOG="$LOG_DIR/launcher.stderr.log"

usage() {
  echo "usage: $0 <path-to-app> [log-directory] [timeout-seconds] [expected-marker] [expect-backend-crash]" >&2
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

collect_tree() {
  local pid=$1
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    collect_tree "$child"
  done
  TREE_PIDS+=("$pid")
}

cleanup() {
  if [[ -z "$LAUNCHER_PID" ]]; then
    return
  fi

  TREE_PIDS=()
  collect_tree "$LAUNCHER_PID"
  for pid in "${TREE_PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  for _ in {1..20}; do
    if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
      wait "$LAUNCHER_PID" 2>/dev/null || true
      return
    fi
    sleep 0.1
  done

  # A wedged WebView must not leak into the next CI step.
  for pid in "${TREE_PIDS[@]}"; do
    kill -KILL "$pid" 2>/dev/null || true
  done
  wait "$LAUNCHER_PID" 2>/dev/null || true
}

fail() {
  echo "macOS bundle smoke test failed: $1" >&2
  dump_logs
  exit 1
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -z "$APP_PATH" ]]; then
  usage
  exit 2
fi
if [[ ! "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  fail "timeout must be a positive integer: $TIMEOUT_SECONDS"
fi
if [[ ! -d "$APP_PATH" || "$APP_PATH" != *.app ]]; then
  fail "application bundle not found: $APP_PATH"
fi

MACOS_DIR="$APP_PATH/Contents/MacOS"
EXECUTABLE=$(find "$MACOS_DIR" -maxdepth 1 -type f -perm -111 -print -quit 2>/dev/null || true)
if [[ -z "$EXECUTABLE" ]]; then
  fail "no executable found under $MACOS_DIR"
fi

mkdir -p "$LOG_DIR"
: > "$STDOUT_LOG"
: > "$STDERR_LOG"

echo "Launching $EXECUTABLE ..."
ORIGINAL_DIR=$PWD
cd "$(dirname "$EXECUTABLE")"
"./$(basename "$EXECUTABLE")" >"$STDOUT_LOG" 2>"$STDERR_LOG" &
LAUNCHER_PID=$!
cd "$ORIGINAL_DIR"

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
PORT=''
while (( SECONDS < DEADLINE )); do
  PORT=$(sed -n 's/.*MURASAKI_PORT=\([0-9][0-9]*\).*/\1/p' "$STDOUT_LOG" | tail -n 1)
  if [[ -n "$PORT" ]]; then
    break
  fi
  if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    wait "$LAUNCHER_PID" 2>/dev/null || true
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
  if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    wait "$LAUNCHER_PID" 2>/dev/null || true
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
    if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
      wait "$LAUNCHER_PID" 2>/dev/null || true
      fail 'launcher exited before the renderer probe completed'
    fi
    sleep 0.25
  done

  if [[ "$MARKER_OK" != true ]]; then
    fail "renderer probe did not report the expected marker within ${TIMEOUT_SECONDS}s: $EXPECTED_MARKER"
  fi
  echo 'Renderer multi-window probe passed.'
fi

sleep 2
if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
  wait "$LAUNCHER_PID" 2>/dev/null || true
  fail 'launcher exited shortly after the backend became ready'
fi

if [[ "$EXPECT_BACKEND_CRASH" == true ]]; then
  NODE_PID=$(pgrep -P "$LAUNCHER_PID" | head -n 1 || true)
  if [[ -z "$NODE_PID" ]]; then
    fail 'could not find the bundled Node child for crash supervision test'
  fi
  echo "Killing bundled Node child $NODE_PID to verify host supervision ..."
  kill -KILL "$NODE_PID"
  CRASH_DEADLINE=$((SECONDS + 10))
  while (( SECONDS < CRASH_DEADLINE )); do
    if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
      break
    fi
    sleep 0.1
  done
  if kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    fail 'launcher left a dead UI running after the bundled Node child exited'
  fi
  set +e
  wait "$LAUNCHER_PID"
  LAUNCHER_STATUS=$?
  set -e
  LAUNCHER_PID=''
  if [[ $LAUNCHER_STATUS -eq 0 ]]; then
    fail 'launcher reported success after an unexpected bundled Node exit'
  fi
  if [[ -e "$APP_PATH/Contents/Resources/.murasaki-apply.json" ]]; then
    fail 'launcher retained an unconfirmed update handoff after backend failure'
  fi
  echo 'Unexpected bundled Node exit closed the host with a non-zero status.'
else
  echo 'Launcher is still running; macOS bundle smoke test passed.'
fi

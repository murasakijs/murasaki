#!/usr/bin/env bash
# End-to-end exercise of the Linux distribution story for an unsigned
# Murasaki deliverable: launch the AppImage, apply a verified self-update
# (journaled single-file swap of the running .AppImage — see
# crates/native/src/updater.rs's apply_linux), assert swap + relaunch +
# startup health acknowledgement, reject a corrupt/mismatched-sha256
# payload, roll back a first-launch failure, then install/launch/uninstall
# the .deb. Mirrors mac-installer-e2e.sh's shape/checkpoints.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# --apply-update's own relaunch (apply_linux's relaunch(), always
# `--appimage-extract-and-run`) needs a live display + session bus for its
# whole run, not just the bracketing linux-smoke-test.sh calls — so unlike
# that script, this one needs ONE display alive for its entire duration.
# Self-wrap under xvfb-run + a private D-Bus session if the caller (a human,
# or a workflow step that didn't already do this) hasn't set one up.
if [[ -z "${DISPLAY:-}" ]]; then
  export WEBKIT_DISABLE_DMABUF_RENDERER=1
  export WEBKIT_DISABLE_COMPOSITING_MODE=1
  export LIBGL_ALWAYS_SOFTWARE=1
  exec xvfb-run -a --server-args="-screen 0 1280x800x24" \
    dbus-run-session -- "$0" "$@"
fi

APPDIR_PATH=${1:-}
APPIMAGE_PATH=${2:-}
DEB_PATH=${3:-}
WORK_ROOT=${4:-"${RUNNER_TEMP:-/tmp}/murasaki-linux-installer-e2e"}
TIMEOUT_SECONDS=${5:-90}

if [[ -z "$APPDIR_PATH" || -z "$APPIMAGE_PATH" || -z "$DEB_PATH" ]]; then
  echo "usage: $0 <AppDir> <v1.AppImage> <deb-path> [work-root] [timeout-seconds]" >&2
  exit 2
fi
if [[ ! -d "$APPDIR_PATH" || ! -f "$APPIMAGE_PATH" || ! -f "$DEB_PATH" ]]; then
  echo "missing AppDir, AppImage, or .deb: $APPDIR_PATH / $APPIMAGE_PATH / $DEB_PATH" >&2
  exit 2
fi

APPIMAGE_JS="$SCRIPT_DIR/../../packages/murasaki/dist/cli/appimage.js"
if [[ ! -f "$APPIMAGE_JS" ]]; then
  echo "missing compiled appimage.js — run \`pnpm --filter murasaki build\` first: $APPIMAGE_JS" >&2
  exit 2
fi

RESOURCES_DIR=$(find "$APPDIR_PATH/usr/lib" -mindepth 1 -maxdepth 1 -type d -print -quit)/resources
[[ -d "$RESOURCES_DIR" ]] || { echo "could not locate usr/lib/<appId>/resources under $APPDIR_PATH" >&2; exit 1; }
ARCH=$(node -p "process.arch === 'arm64' ? 'arm64' : 'x64'")

rm -rf "$WORK_ROOT"
mkdir -p "$WORK_ROOT"
INSTALL_ROOT="$WORK_ROOT/Applications"
mkdir -p "$INSTALL_ROOT"
INSTALLED="$INSTALL_ROOT/App.AppImage"
JOURNAL="$INSTALL_ROOT/.App.AppImage.murasaki-update.json"
cp "$APPIMAGE_PATH" "$INSTALLED"
chmod +x "$INSTALLED"

export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1

echo 'Smoke-testing the freshly installed v1 AppImage ...'
bash "$SCRIPT_DIR/linux-smoke-test.sh" "$INSTALLED" "$WORK_ROOT/first-launch" 60

# ── Build a v2 payload (a marker file differentiates its content/hash) and
#    an intentionally broken v3 (missing the bundled node runtime) from the
#    same already-bundled AppDir — mirrors mac-installer-e2e.sh's ditto +
#    marker-file approach rather than re-running `murasaki bundle`.
node --input-type=module -e "
import { cp, rm, writeFile } from 'node:fs/promises'
import { buildAppImage } from '$APPIMAGE_JS'

await cp('$APPDIR_PATH', '$WORK_ROOT/v2.AppDir', { recursive: true })
await writeFile('$RESOURCES_DIR'.replace('$APPDIR_PATH', '$WORK_ROOT/v2.AppDir') + '/.murasaki-e2e-marker', 'v2\n')
await buildAppImage('$WORK_ROOT/v2.AppDir', '$WORK_ROOT/v2.AppImage', '$ARCH')

await cp('$APPDIR_PATH', '$WORK_ROOT/broken.AppDir', { recursive: true })
await rm('$RESOURCES_DIR'.replace('$APPDIR_PATH', '$WORK_ROOT/broken.AppDir') + '/node', { force: true })
await buildAppImage('$WORK_ROOT/broken.AppDir', '$WORK_ROOT/broken.AppImage', '$ARCH')
console.log('built v2 + broken AppImage payloads')
"

V2_APPIMAGE="$WORK_ROOT/v2.AppImage"
BROKEN_APPIMAGE="$WORK_ROOT/broken.AppImage"
[[ -f "$V2_APPIMAGE" && -f "$BROKEN_APPIMAGE" ]] || { echo 'failed to build v2/broken AppImage fixtures' >&2; exit 1; }

find_launcher_in_appimage() {
  # $1: AppImage to extract; echoes the path of its packaged launcher binary.
  local extract_dir
  extract_dir=$(mktemp -d)
  (cd "$extract_dir" && "$1" --appimage-extract >/dev/null)
  find "$extract_dir/squashfs-root/usr/bin" -maxdepth 1 -type f -perm -111 -print -quit
}

installed_matches() {
  [[ "$(sha256sum "$INSTALLED" | awk '{print $1}')" == "$(sha256sum "$1" | awk '{print $1}')" ]]
}

# `--appimage-extract-and-run`'s own wrapper exits almost immediately after
# forking the real launcher (reparenting it to init) — see
# linux-smoke-test.sh's module doc comment for the same fact. The only
# reliable way to stop a running instance from here, and to know it's
# actually gone before the next launch (single-instance would otherwise
# silently activate the still-live one instead of starting fresh), is by
# this extraction path pattern rather than any pid this script itself holds.
#
# The launcher installs no SIGTERM handler of its own (its graceful-shutdown
# path is driven by window-close/quit IPC, not OS signals — see launcher.rs),
# so signaling only the launcher process leaves its bundled Node child
# (still holding the app's stable port) orphaned. Kill both patterns so the
# next launch doesn't fail with EADDRINUSE.
stop_running_instance() {
  pkill -TERM -f 'appimage_extracted_.*/usr/bin/' 2>/dev/null || true
  pkill -TERM -f 'appimage_extracted_.*/resources/node ' 2>/dev/null || true
  for _ in {1..50}; do
    pgrep -f 'appimage_extracted_.*(/usr/bin/|/resources/node )' >/dev/null 2>&1 || return 0
    sleep 0.1
  done
  pkill -KILL -f 'appimage_extracted_.*/usr/bin/' 2>/dev/null || true
  pkill -KILL -f 'appimage_extracted_.*/resources/node ' 2>/dev/null || true
  sleep 0.5
}

wait_until() {
  # wait_until <deadline> <description> <predicate...>
  local deadline=$1 description=$2
  shift 2
  while (( SECONDS < deadline )); do
    if "$@"; then return 0; fi
    sleep 0.3
  done
  echo "timed out waiting for: $description" >&2
  return 1
}

LAUNCHER=$(find_launcher_in_appimage "$INSTALLED")
[[ -x "$LAUNCHER" ]] || { echo 'could not extract the installed AppImage launcher' >&2; exit 1; }

# ── Apply a verified v2 payload; assert swap + relaunch + health ack ───────
V2_SHA256=$(sha256sum "$V2_APPIMAGE" | awk '{print $1}')
sleep 3 &
WAIT_PID=$!
echo "Applying verified v2 payload (wait pid $WAIT_PID) ..."
"$LAUNCHER" --apply-update \
  --payload "$V2_APPIMAGE" --sha256 "$V2_SHA256" --wait-pid "$WAIT_PID" \
  --target "$INSTALLED" --relaunch "$INSTALLED" \
  >"$WORK_ROOT/apply-v2.stdout.log" 2>"$WORK_ROOT/apply-v2.stderr.log"

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
wait_until "$DEADLINE" 'installed AppImage becomes v2' installed_matches "$V2_APPIMAGE" || {
  cat "$WORK_ROOT/apply-v2.stdout.log" "$WORK_ROOT/apply-v2.stderr.log" >&2
  exit 1
}
echo 'Installed AppImage is now v2 (by content hash).'

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
wait_until "$DEADLINE" 'journal cleared after startup health ack' \
  bash -c "[[ ! -e '$JOURNAL' ]]" || {
  echo 'v2 relaunch never reached the startup health checkpoint' >&2
  cat "$JOURNAL" 2>/dev/null || true
  exit 1
}
wait_until "$DEADLINE" 'backup cleared after startup health ack' \
  bash -c "[[ \$(find '$INSTALL_ROOT' -maxdepth 1 -name '.App.AppImage.murasaki-backup-*' | wc -l) == 0 ]]" || exit 1
echo 'Startup health acknowledgement reached: journal and backup both cleared.'

stop_running_instance
sleep 1

echo 'Smoke-testing the updated (v2) installed AppImage ...'
bash "$SCRIPT_DIR/linux-smoke-test.sh" "$INSTALLED" "$WORK_ROOT/updated-launch" 60

# ── A bad digest must be rejected before the current (v2) install is
#    touched. ─────────────────────────────────────────────────────────────
sleep 2 &
WAIT_PID=$!
set +e
"$LAUNCHER" --apply-update \
  --payload "$V2_APPIMAGE" --sha256 "$(printf '0%.0s' {1..64})" --wait-pid "$WAIT_PID" \
  --target "$INSTALLED" --relaunch "$INSTALLED" \
  >"$WORK_ROOT/apply-corrupt.stdout.log" 2>"$WORK_ROOT/apply-corrupt.stderr.log"
CORRUPT_STATUS=$?
set -e
if [[ $CORRUPT_STATUS -eq 0 || -e "$JOURNAL" ]] || ! installed_matches "$V2_APPIMAGE"; then
  cat "$WORK_ROOT/apply-corrupt.stdout.log" "$WORK_ROOT/apply-corrupt.stderr.log" >&2
  echo 'corrupt update was accepted or damaged the installed AppImage' >&2
  exit 1
fi
echo 'Corrupt/mismatched-sha256 payload rejected; v2 install untouched.'

# ── First-launch rollback: an intentionally broken payload (missing the
#    bundled node runtime) installs and relaunches, but its Node backend can
#    never start — imp_linux exits before the startup health checkpoint,
#    leaving the journal "attempted". Relaunching the (broken) install
#    triggers the external recovery helper, restoring v2. ─────────────────
BROKEN_SHA256=$(sha256sum "$BROKEN_APPIMAGE" | awk '{print $1}')
sleep 3 &
WAIT_PID=$!
echo "Applying intentionally broken payload (wait pid $WAIT_PID) ..."
"$LAUNCHER" --apply-update \
  --payload "$BROKEN_APPIMAGE" --sha256 "$BROKEN_SHA256" --wait-pid "$WAIT_PID" \
  --target "$INSTALLED" --relaunch "$INSTALLED" \
  >"$WORK_ROOT/apply-broken.stdout.log" 2>"$WORK_ROOT/apply-broken.stderr.log"

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
wait_until "$DEADLINE" 'installed AppImage becomes the broken payload' installed_matches "$BROKEN_APPIMAGE" || exit 1
wait_until "$DEADLINE" 'broken relaunch reaches the attempted-health state' \
  bash -c "[[ -e '$JOURNAL' ]] && grep -q attempted '$JOURNAL'" || {
  echo 'broken update never reached the attempted health state' >&2
  cat "$JOURNAL" 2>/dev/null || true
  exit 1
}
echo 'Broken relaunch failed before health ack, as expected (journal: attempted).'

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < DEADLINE )); do
  BACKUP_COUNT=$(find "$INSTALL_ROOT" -maxdepth 1 -name '.App.AppImage.murasaki-backup-*' | wc -l)
  if [[ ! -e "$JOURNAL" && "$BACKUP_COUNT" == 0 ]]; then
    break
  fi
  "$INSTALLED" --appimage-extract-and-run >>"$WORK_ROOT/recovery-trigger.stdout.log" 2>>"$WORK_ROOT/recovery-trigger.stderr.log" || true
  sleep 1
done
BACKUP_COUNT=$(find "$INSTALL_ROOT" -maxdepth 1 -name '.App.AppImage.murasaki-backup-*' | wc -l)
if [[ -e "$JOURNAL" || "$BACKUP_COUNT" != 0 ]] || ! installed_matches "$V2_APPIMAGE"; then
  cat "$WORK_ROOT/recovery-trigger.stdout.log" "$WORK_ROOT/recovery-trigger.stderr.log" >&2 || true
  echo 'broken update was not rolled back to v2' >&2
  exit 1
fi
echo 'Broken update rolled back to v2 by the external recovery helper.'
stop_running_instance
sleep 1

# ── .deb: install with dpkg, launch from /usr/bin, uninstall ──────────────
echo "Installing $DEB_PATH with dpkg ..."
sudo dpkg -i "$DEB_PATH"
DEB_PACKAGE=$(dpkg-deb -f "$DEB_PATH" Package)
LAUNCHER_NAME=$(dpkg -L "$DEB_PACKAGE" | grep -E '^/usr/bin/[^./]+$' | head -n 1 | xargs -r basename)
[[ -n "$LAUNCHER_NAME" ]] || { echo "could not resolve the installed launcher name from dpkg -L $DEB_PACKAGE" >&2; exit 1; }
DEB_LAUNCHER="/usr/bin/$LAUNCHER_NAME"
[[ -x "$DEB_LAUNCHER" ]] || { echo "$DEB_LAUNCHER was not installed executable" >&2; exit 1; }

echo "Launching $DEB_LAUNCHER (installed via dpkg) ..."
"$DEB_LAUNCHER" >"$WORK_ROOT/deb-launch.stdout.log" 2>"$WORK_ROOT/deb-launch.stderr.log" &
DEB_PID=$!
DEADLINE=$((SECONDS + 60))
PORT=''
while (( SECONDS < DEADLINE )); do
  PORT=$(sed -n 's/.*MURASAKI_PORT=\([0-9][0-9]*\).*/\1/p' "$WORK_ROOT/deb-launch.stdout.log" | tail -n 1)
  [[ -n "$PORT" ]] && break
  kill -0 "$DEB_PID" 2>/dev/null || { cat "$WORK_ROOT/deb-launch.stdout.log" "$WORK_ROOT/deb-launch.stderr.log" >&2; echo 'deb-installed launcher exited before reporting a port' >&2; exit 1; }
  sleep 0.5
done
[[ -n "$PORT" ]] || { echo 'deb-installed launcher never reported MURASAKI_PORT' >&2; exit 1; }
STATUS=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/")
[[ "$STATUS" == '200' ]] || { echo "deb-installed backend returned $STATUS, not 200" >&2; exit 1; }
echo 'deb-installed launcher resolved its resources dir correctly and served HTTP 200.'
kill -TERM "$DEB_PID" 2>/dev/null || true
sleep 1
kill -KILL "$DEB_PID" 2>/dev/null || true
wait "$DEB_PID" 2>/dev/null || true

echo "Uninstalling $DEB_PACKAGE ..."
sudo dpkg -r "$DEB_PACKAGE"
if [[ -e "$DEB_LAUNCHER" ]]; then
  echo "uninstall left $DEB_LAUNCHER behind" >&2
  exit 1
fi

echo 'Linux AppImage install, update, health acknowledgement, rejection, rollback, and .deb install/launch/uninstall all passed.'

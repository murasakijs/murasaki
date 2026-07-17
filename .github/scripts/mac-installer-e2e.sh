#!/usr/bin/env bash
# End-to-end exercises an unsigned Murasaki macOS deliverable on a disposable
# install root. It mounts the real DMG, copies the app out exactly as a user
# would, launches it, applies a verified .app.zip update, waits for the new
# launcher's health acknowledgement, rejects a corrupt payload, and removes
# the installed app again.

set -euo pipefail

DMG_PATH=${1:-}
BUNDLE_PATH=${2:-}
ARCH=${3:-}
WORK_ROOT=${4:-"${RUNNER_TEMP:-/tmp}/murasaki-mac-installer-e2e"}
TIMEOUT_SECONDS=${5:-120}

if [[ -z "$DMG_PATH" || -z "$BUNDLE_PATH" || -z "$ARCH" ]]; then
  echo "usage: $0 <dmg> <source-app> <arm64|x64> [work-root] [timeout-seconds]" >&2
  exit 2
fi
if [[ ! -f "$DMG_PATH" || ! -d "$BUNDLE_PATH" ]]; then
  echo "missing DMG or app bundle: $DMG_PATH / $BUNDLE_PATH" >&2
  exit 2
fi
if [[ "$ARCH" != arm64 && "$ARCH" != x64 ]]; then
  echo "unsupported architecture: $ARCH" >&2
  exit 2
fi

PRODUCT_NAME=$(basename "$BUNDLE_PATH" .app)
MOUNT_POINT="$WORK_ROOT/mount"
INSTALL_ROOT="$WORK_ROOT/Applications"
INSTALLED_APP="$INSTALL_ROOT/$PRODUCT_NAME.app"
JOURNAL_PATH="$INSTALL_ROOT/.$PRODUCT_NAME.app.murasaki-update.json"
V2_APP="$WORK_ROOT/v2/$PRODUCT_NAME.app"
V2_ZIP="$WORK_ROOT/$PRODUCT_NAME-darwin-$ARCH-v2.app.zip"
BROKEN_APP="$WORK_ROOT/broken/$PRODUCT_NAME.app"
BROKEN_ZIP="$WORK_ROOT/$PRODUCT_NAME-darwin-$ARCH-broken.app.zip"
MARKER_RELATIVE='Contents/Resources/.murasaki-e2e-marker'
MARKER_PATH="$INSTALLED_APP/$MARKER_RELATIVE"
BROKEN_MARKER_RELATIVE='Contents/Resources/.murasaki-e2e-broken-marker'
BROKEN_MARKER_PATH="$INSTALLED_APP/$BROKEN_MARKER_RELATIVE"
APPLY_STDOUT="$WORK_ROOT/apply.stdout.log"
APPLY_STDERR="$WORK_ROOT/apply.stderr.log"
ATTACHED=false

find_launcher() {
  find "$1/Contents/MacOS" -maxdepth 1 -type f -perm -111 -print -quit
}

stop_installed_app() {
  local executable
  local canonical_executable
  local canonical_node
  executable=$(find_launcher "$INSTALLED_APP" 2>/dev/null || true)
  if [[ -n "$executable" ]]; then
    # `/tmp` is `/private/tmp` on macOS. LaunchServices reports the canonical
    # executable path, so match that form as well as the caller-facing path.
    canonical_executable=$(realpath "$executable" 2>/dev/null || printf '%s' "$executable")
    canonical_node="$(dirname "$(dirname "$canonical_executable")")/Resources/node"
    pkill -TERM -f "^${canonical_executable//./\\.}" 2>/dev/null || true
    pkill -TERM -f "^${executable//./\\.}" 2>/dev/null || true
    pkill -TERM -f "^${canonical_node//./\\.} prod-server\\.mjs" 2>/dev/null || true
    sleep 1
    pkill -KILL -f "^${canonical_executable//./\\.}" 2>/dev/null || true
    pkill -KILL -f "^${executable//./\\.}" 2>/dev/null || true
    pkill -KILL -f "^${canonical_node//./\\.} prod-server\\.mjs" 2>/dev/null || true
  fi
}

cleanup() {
  stop_installed_app || true
  if [[ "$ATTACHED" == true ]]; then
    hdiutil detach "$MOUNT_POINT" -force >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

rm -rf "$WORK_ROOT"
mkdir -p "$MOUNT_POINT" "$INSTALL_ROOT" "$WORK_ROOT/v2" "$WORK_ROOT/broken"

echo "Mounting $DMG_PATH ..."
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_POINT" -nobrowse -readonly >/dev/null
ATTACHED=true

DMG_APP="$MOUNT_POINT/$PRODUCT_NAME.app"
[[ -d "$DMG_APP" ]] || { echo "DMG does not contain $PRODUCT_NAME.app" >&2; exit 1; }
[[ -L "$MOUNT_POINT/Applications" ]] || { echo 'DMG is missing the Applications symlink' >&2; exit 1; }
[[ "$(readlink "$MOUNT_POINT/Applications")" == /Applications ]] || {
  echo 'DMG Applications link does not target /Applications' >&2
  exit 1
}

ditto "$DMG_APP" "$INSTALLED_APP"
hdiutil detach "$MOUNT_POINT" >/dev/null
ATTACHED=false

codesign --verify --deep --strict "$INSTALLED_APP"
echo 'Launching the app copied from the DMG ...'
bash "$(dirname "$0")/mac-smoke-test.sh" "$INSTALLED_APP" "$WORK_ROOT/first-launch" 60

# Prove first-launch rollback with a validly signed, correctly hashed update
# whose packaged Node runtime is deliberately missing. The first launch marks
# the journal attempted and fails before health ACK. A second launch observes
# the dead attempt PID, hands recovery to an external helper, restores v1, and
# relaunches it.
ditto "$BUNDLE_PATH" "$BROKEN_APP"
printf 'broken\n' > "$BROKEN_APP/$BROKEN_MARKER_RELATIVE"
rm -f "$BROKEN_APP/Contents/Resources/node"
codesign --force --deep --sign - "$BROKEN_APP"
codesign --verify --deep --strict "$BROKEN_APP"
ditto -c -k --sequesterRsrc --keepParent "$BROKEN_APP" "$BROKEN_ZIP"

LAUNCHER=$(find_launcher "$INSTALLED_APP")
BROKEN_SHA256=$(shasum -a 256 "$BROKEN_ZIP" | awk '{print $1}')
sleep 3 &
WAIT_PID=$!
echo "Applying intentionally unhealthy payload (wait pid $WAIT_PID) ..."
"$LAUNCHER" \
  --apply-update \
  --payload "$BROKEN_ZIP" \
  --sha256 "$BROKEN_SHA256" \
  --wait-pid "$WAIT_PID" \
  --target "$INSTALLED_APP" \
  --relaunch "$INSTALLED_APP" \
  >"$WORK_ROOT/broken-apply.stdout.log" 2>"$WORK_ROOT/broken-apply.stderr.log"

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < DEADLINE )); do
  if [[ -f "$BROKEN_MARKER_PATH" && -f "$JOURNAL_PATH" ]]; then
    BROKEN_LAUNCHER=$(find_launcher "$INSTALLED_APP")
    if ! pgrep -f "^${BROKEN_LAUNCHER//./\\.}" >/dev/null 2>&1; then
      break
    fi
  fi
  sleep 0.5
done
if [[ ! -f "$BROKEN_MARKER_PATH" || ! -f "$JOURNAL_PATH" ]]; then
  cat "$WORK_ROOT/broken-apply.stdout.log" "$WORK_ROOT/broken-apply.stderr.log" >&2 || true
  echo 'unhealthy update did not reach the attempted health state' >&2
  exit 1
fi

BROKEN_LAUNCHER=$(find_launcher "$INSTALLED_APP")
: >"$WORK_ROOT/recovery-trigger.stdout.log"
: >"$WORK_ROOT/recovery-trigger.stderr.log"
DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < DEADLINE )); do
  BACKUP_COUNT=$(find "$INSTALL_ROOT" -maxdepth 1 -name ".$PRODUCT_NAME.app.murasaki-backup-*" | wc -l | tr -d ' ')
  if [[ ! -f "$BROKEN_MARKER_PATH" && ! -e "$JOURNAL_PATH" && "$BACKUP_COUNT" == 0 ]]; then
    break
  fi
  # LaunchServices can keep the failed first-launch PID observable briefly
  # while reaping it. Retry the user-visible second launch until that process
  # is definitively gone and the external recovery helper can take ownership.
  "$BROKEN_LAUNCHER" >>"$WORK_ROOT/recovery-trigger.stdout.log" 2>>"$WORK_ROOT/recovery-trigger.stderr.log" || true
  sleep 1
done
BACKUP_COUNT=$(find "$INSTALL_ROOT" -maxdepth 1 -name ".$PRODUCT_NAME.app.murasaki-backup-*" | wc -l | tr -d ' ')
if [[ -f "$BROKEN_MARKER_PATH" || -e "$JOURNAL_PATH" || "$BACKUP_COUNT" != 0 ]]; then
  cat "$WORK_ROOT/recovery-trigger.stdout.log" "$WORK_ROOT/recovery-trigger.stderr.log" >&2 || true
  echo 'unhealthy first launch was not rolled back to v1' >&2
  exit 1
fi
codesign --verify --deep --strict "$INSTALLED_APP"
stop_installed_app
bash "$(dirname "$0")/mac-smoke-test.sh" "$INSTALLED_APP" "$WORK_ROOT/recovered-launch" 60

# Create a second, correctly signed payload with an unambiguous file marker.
# The framework updater consumes the same ditto archive shape emitted by
# bundle.ts, including resource forks and the outer .app directory.
ditto "$BUNDLE_PATH" "$V2_APP"
printf 'v2\n' > "$V2_APP/$MARKER_RELATIVE"
codesign --force --deep --sign - "$V2_APP"
codesign --verify --deep --strict "$V2_APP"
ditto -c -k --sequesterRsrc --keepParent "$V2_APP" "$V2_ZIP"

LAUNCHER=$(find_launcher "$INSTALLED_APP")
[[ -x "$LAUNCHER" ]] || { echo 'installed launcher is missing' >&2; exit 1; }
SHA256=$(shasum -a 256 "$V2_ZIP" | awk '{print $1}')

# The wait pid mirrors the real handoff, where the updater waits for the old
# application process before replacing the bundle.
sleep 3 &
WAIT_PID=$!
echo "Applying verified v2 payload (wait pid $WAIT_PID) ..."
set +e
"$LAUNCHER" \
  --apply-update \
  --payload "$V2_ZIP" \
  --sha256 "$SHA256" \
  --wait-pid "$WAIT_PID" \
  --target "$INSTALLED_APP" \
  --relaunch "$INSTALLED_APP" \
  >"$APPLY_STDOUT" 2>"$APPLY_STDERR"
APPLY_STATUS=$?
set -e
if [[ $APPLY_STATUS -ne 0 ]]; then
  cat "$APPLY_STDOUT" "$APPLY_STDERR" >&2 || true
  echo "verified update failed with status $APPLY_STATUS" >&2
  exit 1
fi

DEADLINE=$((SECONDS + TIMEOUT_SECONDS))
while (( SECONDS < DEADLINE )); do
  # A healthy first launch removes both the journal and same-volume backup.
  BACKUP_COUNT=$(find "$INSTALL_ROOT" -maxdepth 1 -name ".$PRODUCT_NAME.app.murasaki-backup-*" | wc -l | tr -d ' ')
  if [[ -f "$MARKER_PATH" && ! -e "$JOURNAL_PATH" && "$BACKUP_COUNT" == 0 ]]; then
    break
  fi
  sleep 0.5
done

BACKUP_COUNT=$(find "$INSTALL_ROOT" -maxdepth 1 -name ".$PRODUCT_NAME.app.murasaki-backup-*" | wc -l | tr -d ' ')
if [[ ! -f "$MARKER_PATH" || -e "$JOURNAL_PATH" || "$BACKUP_COUNT" != 0 ]]; then
  cat "$APPLY_STDOUT" "$APPLY_STDERR" >&2 || true
  echo 'updated app did not reach the startup health checkpoint' >&2
  exit 1
fi

stop_installed_app
echo 'Launching the updated installed app ...'
bash "$(dirname "$0")/mac-smoke-test.sh" "$INSTALLED_APP" "$WORK_ROOT/updated-launch" 60

# A bad digest must fail before the current install is renamed.
LAUNCHER=$(find_launcher "$INSTALLED_APP")
set +e
"$LAUNCHER" \
  --apply-update \
  --payload "$V2_ZIP" \
  --sha256 "$(printf '0%.0s' {1..64})" \
  --wait-pid 999999 \
  --target "$INSTALLED_APP" \
  --relaunch "$INSTALLED_APP" \
  >"$WORK_ROOT/corrupt.stdout.log" 2>"$WORK_ROOT/corrupt.stderr.log"
CORRUPT_STATUS=$?
set -e
if [[ $CORRUPT_STATUS -eq 0 || ! -f "$MARKER_PATH" || -e "$JOURNAL_PATH" ]]; then
  cat "$WORK_ROOT/corrupt.stdout.log" "$WORK_ROOT/corrupt.stderr.log" >&2 || true
  echo 'corrupt update was accepted or damaged the installed app' >&2
  exit 1
fi
codesign --verify --deep --strict "$INSTALLED_APP"

stop_installed_app
rm -rf "$INSTALLED_APP"
[[ ! -e "$INSTALLED_APP" ]] || { echo 'uninstall cleanup failed' >&2; exit 1; }
echo 'macOS DMG install, launch, update, health acknowledgement, rejection, and uninstall passed.'

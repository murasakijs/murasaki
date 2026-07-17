#!/usr/bin/env bash
# Installs the runtime (not build-time) dependencies a packaged Murasaki
# Linux app needs to actually launch: the webkit2gtk/GTK/AppIndicator shared
# libraries the compiled binary links against, `xvfb`/`dbus-x11` for the
# headless launch environment app-package-linux.yml's smoke/E2E scripts use,
# and libfuse2 (a real FUSE mount is opportunistically exercised in this
# feature's own Docker verification, but CI runners lack a reliable
# `/dev/fuse`, so the scripts here always use `--appimage-extract-and-run`
# instead — see the distribution guide's FUSE note).
#
# ubuntu-24.04 renamed several packages with a `t64` suffix (the 64-bit
# `time_t` transition — done fleet-wide across architectures for pool
# consistency, not just the 32-bit archs it was strictly needed for), so the
# exact package name depends on the runner's release. Try the current name
# first, fall back to the pre-24.04 name.

set -euo pipefail

sudo apt-get update

install_first_available() {
  for candidate in "$@"; do
    if sudo apt-get install -y --no-install-recommends "$candidate" 2>/dev/null; then
      echo "installed $candidate"
      return 0
    fi
  done
  echo "none of the candidate packages could be installed: $*" >&2
  return 1
}

sudo apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-0 libayatana-appindicator3-1 xvfb dbus-x11 curl

install_first_available libgtk-3-0t64 libgtk-3-0
install_first_available libfuse2t64 libfuse2

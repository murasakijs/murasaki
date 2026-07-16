#!/bin/sh

set -eu

VERSION="0.47.2"
RELEASE_TAG="samples-v0.47.2"
RELEASE_ROOT="https://github.com/murasakijs/murasaki/releases/download/${RELEASE_TAG}"

usage() {
  echo "Usage: run-sample-demo.sh <violet-notes|murasaki-focus|local-signal>" >&2
  exit 2
}

case "${1:-}" in
  violet-notes)
    asset_stem="Violet-Notes"
    app_name="Violet Notes"
    ;;
  murasaki-focus)
    asset_stem="Murasaki-Focus"
    app_name="Murasaki Focus"
    ;;
  local-signal)
    asset_stem="Local-Signal"
    app_name="Local Signal"
    ;;
  *)
    usage
    ;;
esac

case "$(uname -m)" in
  arm64)
    target="darwin-arm64"
    ;;
  x86_64)
    target="darwin-x64"
    ;;
  *)
    echo "Murasaki demos currently support Apple silicon and Intel Macs." >&2
    exit 1
    ;;
esac

asset="${asset_stem}-${VERSION}-${target}.dmg"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/murasaki-demo.XXXXXX")"
mount_dir="${work_dir}/mount"
dmg_path="${work_dir}/${asset}"
checksums_path="${work_dir}/SHA256SUMS"
mounted=0

cleanup() {
  if [ "${mounted}" -eq 1 ]; then
    hdiutil detach "${mount_dir}" >/dev/null 2>&1 || true
  fi
  rm -rf "${work_dir}"
}
trap cleanup EXIT INT TERM

mkdir -p "${mount_dir}"

echo "Downloading ${app_name} (${target})…"
curl --fail --location --silent --show-error \
  "${RELEASE_ROOT}/${asset}" \
  --output "${dmg_path}"
curl --fail --location --silent --show-error \
  "${RELEASE_ROOT}/SHA256SUMS" \
  --output "${checksums_path}"

expected_sha="$(awk -v asset="${asset}" '$2 == asset { print $1 }' "${checksums_path}")"
actual_sha="$(shasum -a 256 "${dmg_path}" | awk '{ print $1 }')"

if [ -z "${expected_sha}" ] || [ "${expected_sha}" != "${actual_sha}" ]; then
  echo "Checksum verification failed for ${asset}." >&2
  exit 1
fi

echo "Checksum verified. Preparing the demo…"
hdiutil attach "${dmg_path}" \
  -mountpoint "${mount_dir}" \
  -nobrowse \
  -readonly >/dev/null
mounted=1

source_app="${mount_dir}/${app_name}.app"
cache_root="${HOME}/Library/Caches/murasaki-demos/${VERSION}-${target}"
installed_app="${cache_root}/${app_name}.app"

if [ ! -d "${installed_app}" ]; then
  mkdir -p "${cache_root}"
  ditto "${source_app}" "${installed_app}"
fi

# Browser downloads receive a quarantine marker that Gatekeeper will reject
# without Developer ID notarization. Running this script is the user's explicit
# opt-in to launch the checksum-verified open-source demo build.
xattr -dr com.apple.quarantine "${installed_app}" 2>/dev/null || true

echo "Opening ${app_name}…"
open -n "${installed_app}"
echo "Demo location: ${installed_app}"

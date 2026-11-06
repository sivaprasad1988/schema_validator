#!/usr/bin/env bash
# Renders assets/icon.svg to src/icons/icon-{16,32,48,128}.png with transparent background.
# Requires Google Chrome (headless). Default path is macOS; override with CHROME=/path/to/chrome.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p src/icons
for n in 16 32 48 128; do
  svg="$(sed "s/width=\"128\" height=\"128\"/width=\"$n\" height=\"$n\"/" assets/icon.svg)"
  printf '<html><body style="margin:0;background:transparent">%s</body></html>' "$svg" > "$TMP/icon-$n.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$n,$n" \
    --screenshot="$PWD/src/icons/icon-$n.png" "file://$TMP/icon-$n.html" >/dev/null 2>&1
  echo "src/icons/icon-$n.png"
done

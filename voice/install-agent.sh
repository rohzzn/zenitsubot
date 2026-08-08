#!/bin/bash
#
# Installs the voice server so it is simply always running: at login, after a
# crash, without anyone typing a command.
#
# The runtime is installed *outside* the repo, and that is not tidiness. macOS
# protects ~/Downloads, ~/Documents and ~/Desktop with TCC, and a LaunchAgent
# has no access to them — pointing launchd at a script in the repo failed with
# "Operation not permitted" no matter how it was invoked. Application Support
# is not protected, so the runtime lives there and the repo stays the source.
#
# No sudo anywhere: this is a per-user agent.
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME="$HOME/Library/Application Support/zenitsubot-voice"
LABEL="com.zenitsubot.voice"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "Installing the voice runtime to:"
echo "  $RUNTIME"
echo

mkdir -p "$RUNTIME"

# Source and launcher. Copied rather than symlinked: a symlink into ~/Downloads
# is still a read of ~/Downloads, and TCC blocks it just the same.
cp "$SOURCE_DIR/server.py" "$RUNTIME/server.py"
cp "$SOURCE_DIR/run.sh" "$RUNTIME/run.sh"
cp "$SOURCE_DIR/requirements.txt" "$RUNTIME/requirements.txt"
chmod +x "$RUNTIME/run.sh"

# Kokoro's weights, which the model loads by path. Parakeet needs no copy — it
# loads from ~/.cache/huggingface, which is not a protected location.
for file in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ -f "$SOURCE_DIR/$file" ] && [ ! -f "$RUNTIME/$file" ]; then
    echo "  copying $file"
    cp "$SOURCE_DIR/$file" "$RUNTIME/$file"
  fi
done

# A fresh virtualenv rather than a copied one: a venv records absolute paths and
# does not survive being moved.
if [ ! -x "$RUNTIME/.venv/bin/python" ]; then
  echo "  creating virtualenv (this takes a minute)"
  uv venv --python 3.12 "$RUNTIME/.venv" >/dev/null
  uv pip install --python "$RUNTIME/.venv/bin/python" -r "$RUNTIME/requirements.txt" >/dev/null
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__VOICE_DIR__|$RUNTIME|g" "$SOURCE_DIR/$LABEL.plist" > "$TARGET"

# Unload any older copy first: bootstrap fails outright when the label is
# already loaded, which is the normal case on reinstall.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart "gui/$(id -u)/$LABEL" 2>/dev/null || true

echo
echo "Installed. It starts at login and restarts if it crashes."
echo "A cold start takes about a minute while the models load and warm."
echo
echo "  log:     tail -f /tmp/zenitsu-voice.log"
echo "  status:  launchctl print gui/\$(id -u)/$LABEL | head"
echo "  stop:    launchctl bootout gui/\$(id -u)/$LABEL"
echo
echo "After changing server.py in the repo, run this again to update it."

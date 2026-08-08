#!/bin/bash
#
# Starts the voice server.
#
# A wrapper rather than pointing launchd straight at the interpreter: the venv
# python is a symlink into Homebrew, and launchd refused to exec it with
# EX_CONFIG. Going through bash also means the venv is activated properly, so
# the model libraries resolve the same way they do by hand.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Homebrew is not on a LaunchAgent's default PATH, and libvips and friends live
# there.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Bound to all interfaces so the bot container reaches it via
# host.docker.internal; loopback alone would be invisible to Docker.
export VOICE_HOST="${VOICE_HOST:-0.0.0.0}"
export VOICE_PORT="${VOICE_PORT:-8931}"

exec ./.venv/bin/python server.py

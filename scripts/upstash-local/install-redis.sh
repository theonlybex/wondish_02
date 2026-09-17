#!/usr/bin/env bash
# Builds a real redis-server from source into ~/.wondish/redis/bin so the rate
# limiter can be exercised against Redis locally (docs/rate-limiting.md).
#
# Exists because this machine has neither Homebrew nor Docker; all it needs is
# clang + make (Xcode) and network access to github.com. Takes ~1–2 minutes.
# Safe to rerun: skips when the binary is already there (FORCE=1 to rebuild).
#
#   bash scripts/upstash-local/install-redis.sh
#
# Then start the backend with `npm run redis:local`.
set -euo pipefail

REDIS_VERSION="${REDIS_VERSION:-7.2.12}"   # last BSD-licensed line; @upstash/ratelimit needs nothing newer
REDIS_HOME="${WONDISH_REDIS_HOME:-$HOME/.wondish/redis}"
BIN_DIR="$REDIS_HOME/bin"
BUILD_DIR="$REDIS_HOME/build"

if [ -x "$BIN_DIR/redis-server" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "redis-server already installed: $("$BIN_DIR/redis-server" --version)"
  echo "at $BIN_DIR/redis-server (FORCE=1 to rebuild)"
  exit 0
fi

for tool in cc make curl tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing '$tool' — on macOS run: xcode-select --install" >&2; exit 1; }
done

mkdir -p "$BIN_DIR" "$BUILD_DIR" "$REDIS_HOME/data"
TARBALL="$BUILD_DIR/redis-$REDIS_VERSION.tar.gz"
SRC_DIR="$BUILD_DIR/redis-$REDIS_VERSION"

echo "downloading redis $REDIS_VERSION source…"
curl -fsSL --retry 3 -o "$TARBALL" "https://github.com/redis/redis/archive/refs/tags/$REDIS_VERSION.tar.gz"
rm -rf "$SRC_DIR"
tar -xzf "$TARBALL" -C "$BUILD_DIR"

JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 2)"
echo "building with $JOBS jobs (log: $BUILD_DIR/make.log)…"
# MALLOC=libc: jemalloc is the Linux default; macOS builds use the system
# allocator anyway, this just makes the choice explicit.
if ! make -C "$SRC_DIR" -j"$JOBS" MALLOC=libc >"$BUILD_DIR/make.log" 2>&1; then
  echo "build failed — last 40 lines of $BUILD_DIR/make.log:" >&2
  tail -40 "$BUILD_DIR/make.log" >&2
  exit 1
fi

cp "$SRC_DIR/src/redis-server" "$SRC_DIR/src/redis-cli" "$BIN_DIR/"
rm -rf "$SRC_DIR" "$TARBALL"

echo "installed: $("$BIN_DIR/redis-server" --version)"
echo "  $BIN_DIR/redis-server"
echo "  $BIN_DIR/redis-cli"
echo "next: npm run redis:local"

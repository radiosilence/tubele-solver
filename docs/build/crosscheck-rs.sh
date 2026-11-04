#!/usr/bin/env bash
# Cross-checks the paper's model against tubele-rs, an independent Rust port
# of the game: clones it to a temporary directory, appends a test that dumps
# its clues, stops and zone matches, runs it, and compares with compare.js.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 https://github.com/radiosilence/tubele-rs "$tmp/tubele-rs"
cat "$here/crosscheck/dump.rs" >> "$tmp/tubele-rs/src/engine.rs"
(cd "$tmp/tubele-rs" && DUMP="$tmp/dump.tsv" cargo test -q --release crosscheck_dump -- --ignored >/dev/null)
echo "tubele-rs at $(git -C "$tmp/tubele-rs" rev-parse --short HEAD)"
node "$here/crosscheck/compare.js" "$tmp/dump.tsv"

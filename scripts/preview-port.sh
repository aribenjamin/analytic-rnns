#!/usr/bin/env bash
# Give this checkout its own Vite dev-server port and write .claude/launch.json.
#
# Why: preview_start reuses whatever server is already bound to launch.json's
# port. If two checkouts share a port, preview_start silently serves the wrong
# working copy. Main repo uses 5180; each worktree takes the lowest free port
# >= 5181 here. launch.json is git-ignored so these stay per-checkout.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

port=5181
while lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
  port=$((port + 1))
  if [ "$port" -gt 5279 ]; then
    echo "preview-port: no free port in 5181-5279" >&2
    exit 1
  fi
done

mkdir -p .claude
cat > .claude/launch.json <<JSON
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev", "--", "--port", "${port}", "--strictPort"],
      "port": ${port}
    }
  ]
}
JSON

echo "preview-port: wrote .claude/launch.json (port ${port}) — now run preview_start \"dev\""

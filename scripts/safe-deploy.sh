#!/usr/bin/env bash
#
# Release an Apps Script web app without breaking the URL or surprising users.
#
#   safe-deploy.sh <deploymentId> "what changed"
#
# Enforces the sequence that makes Apps Script releases safe:
#
#   push (HEAD only, users unaffected)
#     -> you verify in the editor against real data
#     -> create an immutable version
#     -> point ONE existing deployment at it
#
# It never runs create-deployment: a new deployment means a new URL, and every
# bookmark pointing at the old one dies.
#
# Run from the directory containing .clasp.json.

set -euo pipefail

die() { printf '\n[safe-deploy] %s\n' "$*" >&2; exit 1; }
say() { printf '\n[safe-deploy] %s\n' "$*"; }

[ $# -ge 1 ] || die "usage: safe-deploy.sh <deploymentId> [\"description\"]"

DEPLOYMENT_ID="$1"
DESCRIPTION="${2:-release $(date '+%Y-%m-%d %H:%M')}"

command -v clasp >/dev/null 2>&1 || die "clasp is not installed (npm i -g @google/clasp)"
[ -f .clasp.json ] || die "no .clasp.json here — run this from the script's source directory"

# clasp v3 renamed these commands; v2 would fail confusingly several steps in.
clasp list-deployments --help >/dev/null 2>&1 \
  || die "this needs clasp v3 (found: $(clasp --version 2>&1 | head -1))"

# ---------------------------------------------------------------------------
# Show the current state, from --json: the human-readable listing can be stale.
# ---------------------------------------------------------------------------
deployments_json() { clasp list-deployments --json 2>/dev/null; }

describe_deployments() {
  deployments_json | python3 -c '
import sys, json
target = sys.argv[1]
try:
    rows = json.load(sys.stdin)
except Exception:
    print("  (could not parse deployment list)"); sys.exit(0)
for r in rows:
    did = r.get("deploymentId", "?")
    ver = r.get("versionNumber", "HEAD")
    desc = r.get("description", "") or ""
    mark = "  <-- TARGET" if did == target else ""
    print("  %-28s v%-6s %s%s" % (did[:28], ver, desc, mark))
' "$1"
}

say "Deployments before release:"
describe_deployments "$DEPLOYMENT_ID"

deployments_json | grep -q "$DEPLOYMENT_ID" \
  || die "deployment $DEPLOYMENT_ID is not in this project. Check the id — updating the wrong one can change a deployment's access level."

# ---------------------------------------------------------------------------
# 1. Push. HEAD only — the live deployment keeps serving its pinned version.
# ---------------------------------------------------------------------------
say "Files that will be pushed (from .claspignore):"
clasp status

say "Pushing to HEAD. Users are NOT affected by this step."
clasp push -f

# ---------------------------------------------------------------------------
# 2. Human verification. This is the whole point of the exercise.
# ---------------------------------------------------------------------------
SCRIPT_ID="$(python3 -c 'import json;print(json.load(open(".clasp.json")).get("scriptId",""))')"
cat <<EOF

────────────────────────────────────────────────────────────────────────────
  HEAD now has your new code. The deployment does NOT yet.

  Open the editor and run diagnose() (or your equivalent read-only check)
  against real data:

    https://script.google.com/home/projects/${SCRIPT_ID}/edit

  Read the output before continuing. If something is wrong, stop here —
  nothing user-facing has changed and there is nothing to roll back.

  Note: the editor's Run dropdown can silently fail to commit a selection
  once the function list scrolls. Check the Executions page if a run's
  output surprises you.
────────────────────────────────────────────────────────────────────────────

EOF

read -r -p "Did the check pass? Type 'yes' to cut the version and release: " answer
[ "$answer" = "yes" ] || die "Stopped. HEAD has your code; the deployment is untouched."

# ---------------------------------------------------------------------------
# 3. Version and point the deployment at it.
# ---------------------------------------------------------------------------
say "Creating version: $DESCRIPTION"
VERSION_OUT="$(clasp create-version "$DESCRIPTION")"
printf '%s\n' "$VERSION_OUT"

VERSION="$(printf '%s' "$VERSION_OUT" | grep -oE '[0-9]+' | tail -1)"
[ -n "$VERSION" ] || die "could not parse the new version number from clasp output"

say "Pointing $DEPLOYMENT_ID at version $VERSION"
# The id is POSITIONAL. --deploymentId is not a flag and errors.
clasp update-deployment "$DEPLOYMENT_ID" --versionNumber "$VERSION"

# ---------------------------------------------------------------------------
# 4. Confirm from --json that the right one moved and the others did not.
# ---------------------------------------------------------------------------
say "Deployments after release:"
describe_deployments "$DEPLOYMENT_ID"

cat <<EOF

[safe-deploy] Released version $VERSION to $DEPLOYMENT_ID.

  Confirm above that ONLY the target moved. If another deployment changed
  version, its access level may have changed with it — a version built from a
  DOMAIN manifest carries DOMAIN wherever you point it.

  Roll back with:
    clasp update-deployment $DEPLOYMENT_ID --versionNumber <previous>

EOF

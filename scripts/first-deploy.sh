#!/usr/bin/env bash
#
# One-time: create the Apps Script project, push, pause for editor setup, then
# create the single production deployment.
#
#   scripts/first-deploy.sh            (run from the repo root)
#
# Later releases use scripts/safe-deploy.sh. This script refuses to run if
# apps-script/.clasp.json already exists, so it cannot create a second deployment.

set -euo pipefail

die() { printf '\n[first-deploy] %s\n' "$*" >&2; exit 1; }
say() { printf '\n[first-deploy] %s\n' "$*"; }

cd "$(dirname "$0")/../apps-script"

command -v clasp >/dev/null 2>&1 || die "clasp is not installed (npm i -g @google/clasp)"
case "$(clasp --version 2>&1 | head -1)" in 3.*) ;; *) die "needs clasp 3.x (found: $(clasp --version 2>&1 | head -1))" ;; esac
[ -f .clasp.json ] && die ".clasp.json exists: the project was already created. Use scripts/safe-deploy.sh."
clasp show-authorized-user 2>/dev/null | grep -qi 'ucsd.edu' \
  || die "run 'clasp login' as your @ucsd.edu account first (and enable the Apps Script API at https://script.google.com/home/usersettings)"

say "Creating the Apps Script project"
clasp create-script --title "CSE Sweatshirt Art Contest" --type standalone --rootDir .
# create-script overwrites the manifest; restore ours.
git checkout -- appsscript.json

say "Files that will be pushed (must be only appsscript.json, Code.gs, Index.html):"
clasp status
read -r -p "Continue with push? [yes/no] " a; [ "$a" = "yes" ] || die "Stopped before push."
clasp push -f

SCRIPT_ID="$(python3 -c 'import json;print(json.load(open(".clasp.json"))["scriptId"])')"
cat <<EOF

────────────────────────────────────────────────────────────────────────────
  Pushed. No deployment exists yet, so nobody can reach the app.

  In the editor: https://script.google.com/home/projects/${SCRIPT_ID}/edit
   1. Project Settings -> Script Properties: add FOLDER_ID and SPREADSHEET_ID.
   2. Run setupSheets (first in the Run menu); accept the permission prompt.
   3. Run diagnose; the log must show the folder reachable and no MISSING/ERROR.
   4. Open https://script.google.com/macros/s/${SCRIPT_ID}/dev and submit a
      test PNG and PDF. Check the folder and sheet, then delete the test entries.
────────────────────────────────────────────────────────────────────────────

EOF
read -r -p "All four passed? Type 'yes' to create the production deployment: " a
[ "$a" = "yes" ] || die "Stopped. Re-run the remaining steps by hand from README 'First deployment'."

VERSION_OUT="$(clasp create-version "initial")"
printf '%s\n' "$VERSION_OUT"
VERSION="$(printf '%s' "$VERSION_OUT" | grep -oE '[0-9]+' | tail -1)"
[ -n "$VERSION" ] || die "could not parse the version number"

clasp create-deployment --versionNumber "$VERSION" --description "prod"
say "Deployments (JSON):"
clasp list-deployments --json

cat <<EOF

[first-deploy] Done. Record the prod deploymentId above in README.md.
  Users' URL: https://script.google.com/a/macros/ucsd.edu/s/<DEPLOYMENT_ID>/exec
  Test it from a second @ucsd.edu account and from a non-UCSD account.
EOF

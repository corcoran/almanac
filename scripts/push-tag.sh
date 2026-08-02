#!/usr/bin/env bash
#
# push-tag.sh — bump the latest vMAJOR.MINOR.PATCH tag and push it.
#
# Pushing a v* tag triggers the release workflow (.github/workflows/release.yml),
# which builds and pushes the api/web/mcp images to GHCR. So this is a release
# action: it refuses to run from a dirty tree, a non-master branch, or a master
# that's behind origin, and it asks for confirmation before tagging + pushing.
#
# Usage:
#   scripts/push-tag.sh major   # v0.5.2 -> v1.0.0
#   scripts/push-tag.sh minor   # v0.5.2 -> v0.6.0
#   scripts/push-tag.sh patch   # v0.5.2 -> v0.5.3
#
set -euo pipefail

part="${1:-}"
case "$part" in
  major | minor | patch) ;;
  *)
    echo "usage: $0 {major|minor|patch}" >&2
    exit 2
    ;;
esac

# --- Safety checks -----------------------------------------------------------

# Must be inside the repo.
cd "$(git rev-parse --show-toplevel)"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "master" ]; then
  echo "refusing: on branch '$branch', not 'master'. Releases are cut from master." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "refusing: working tree has uncommitted changes. Commit or stash first." >&2
  exit 1
fi

# Make sure our view of origin is current, then ensure master isn't behind.
git fetch --quiet origin master
behind="$(git rev-list --count HEAD..origin/master)"
if [ "$behind" -ne 0 ]; then
  echo "refusing: local master is $behind commit(s) behind origin/master. Pull first." >&2
  exit 1
fi

ahead="$(git rev-list --count origin/master..HEAD)"
if [ "$ahead" -ne 0 ]; then
  echo "warning: local master is $ahead commit(s) ahead of origin/master." >&2
  echo "         The tag will point at a commit that isn't on origin yet;" >&2
  echo "         the release workflow's CI gate may not find a passing run." >&2
fi

# --- Compute the next version ------------------------------------------------

# Latest semver tag, or v0.0.0 if none exist yet.
latest="$(git tag --list 'v*' --sort=-v:refname | head -n1)"
latest="${latest:-v0.0.0}"

if [[ ! "$latest" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "refusing: latest tag '$latest' isn't vMAJOR.MINOR.PATCH; bump it manually." >&2
  exit 1
fi
major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"

case "$part" in
  major)
    major=$((major + 1))
    minor=0
    patch=0
    ;;
  minor)
    minor=$((minor + 1))
    patch=0
    ;;
  patch)
    patch=$((patch + 1))
    ;;
esac

next="v${major}.${minor}.${patch}"

# Guard against a re-run that would clobber an existing tag.
if git rev-parse -q --verify "refs/tags/$next" >/dev/null; then
  echo "refusing: tag '$next' already exists." >&2
  exit 1
fi

# Guard: CHANGELOG.md must have an entry for this version before we cut it.
# Keep-a-Changelog headings are bare semver ("## [0.11.0]"), no leading "v".
# This is the enforcement point for the "every release is documented" rule —
# add the entry (move items out of [Unreleased]) before tagging.
changelog="CHANGELOG.md"
version="${next#v}" # strip leading "v" → "0.11.0"
if [ ! -f "$changelog" ]; then
  echo "refusing: $changelog not found; a release must be documented." >&2
  exit 1
fi
# Match a heading like "## [0.11.0]" (optionally followed by " - DATE").
if ! grep -Eq "^##[[:space:]]+\[${version//./\\.}\]" "$changelog"; then
  echo "refusing: $changelog has no entry for $version." >&2
  echo "          Add a '## [$version] - <date>' section (move items out of" >&2
  echo "          [Unreleased]) before cutting the release, then re-run." >&2
  exit 1
fi

# --- Confirm and push --------------------------------------------------------

sha="$(git rev-parse --short HEAD)"
echo "current: $latest"
echo "next:    $next  ($part bump)"
echo "commit:  $sha   ($(git log -1 --pretty=%s))"
read -r -p "Tag and push $next? [y/N] " reply
case "$reply" in
  y | Y) ;;
  *)
    echo "aborted."
    exit 0
    ;;
esac

git tag -a "$next" -m "$next"
git push origin "$next"

echo "pushed $next — release workflow will build and push images."

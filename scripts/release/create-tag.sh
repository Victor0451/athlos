#!/usr/bin/env bash
set -euo pipefail

channel="${1:-}"
[[ "$channel" == beta || "$channel" == production ]] || {
  printf 'usage: create-tag.sh <beta|production>\n' >&2
  exit 1
}

version="$(node -p "require('./package.json').version")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  printf 'release version must be stable SemVer: %s\n' "$version" >&2
  exit 1
}

git fetch --tags --force
if [[ "$channel" == production ]]; then
  tag="v$version"
  [[ -z "$(git tag --list "$tag")" ]] || {
    printf 'stable release tag already exists: %s\n' "$tag" >&2
    exit 1
  }
else
  prefix="v$version-beta."
  latest=0
  while IFS= read -r candidate; do
    number="${candidate#"$prefix"}"
    [[ "$number" =~ ^[0-9]+$ ]] && (( number > latest )) && latest="$number"
  done < <(git tag --list "$prefix*" --sort=version:refname)
  tag="$prefix$((latest + 1))"
fi

git config user.name github-actions
git config user.email github-actions@github.com
git tag -a "$tag" -m "Release $tag"
git push origin "$tag"
printf 'release-tag=%s\n' "$tag" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
printf 'created %s\n' "$tag"

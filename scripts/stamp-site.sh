#!/usr/bin/env bash
# Write version.json into a built site: the commit it was built from and a
# fingerprint of what a visitor sees (every file but the README, LICENSE and
# NOTICE). The showcase records the fingerprint when it films the site for its
# pictures, and its CI fails when the live site has moved on since.
#   scripts/stamp-site.sh DIR
set -euo pipefail
dir="${1:?usage: $0 DIR}"
content="$(cd "$dir" && find . -type f ! -name README.md ! -name LICENSE ! -name NOTICE ! -name version.json ! -name .nojekyll -print0 \
  | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)"
commit="${GITHUB_SHA:-$(git rev-parse HEAD)}"
printf '{"commit": "%s", "content": "%s"}\n' "$commit" "$content" > "$dir/version.json"
echo "stamped $dir: content $content"

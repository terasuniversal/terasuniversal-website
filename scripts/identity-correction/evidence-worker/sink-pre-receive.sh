#!/bin/sh
# Test double for the evidence repository's branch ruleset ("append-only"): installed as the pre-receive hook of the LOCAL bare
# repository that stands in for the private GitHub evidence repository. It rejects ref deletion, non-fast-forward updates and any
# change or removal of an existing file. Failure injection: a file named deny-push inside the repository disables every push.
[ -f "$GIT_DIR/deny-push" ] && { echo "push disabled (test failure injection)" >&2; exit 1; }
zero=0000000000000000000000000000000000000000
while read old new ref; do
  if [ "$new" = "$zero" ]; then echo "deleting a ref is not allowed" >&2; exit 1; fi
  if [ "$old" != "$zero" ]; then
    git merge-base --is-ancestor "$old" "$new" || { echo "non-fast-forward is not allowed" >&2; exit 1; }
    bad=$(git diff --name-status "$old" "$new" | grep -v '^A' | head -1)
    if [ -n "$bad" ]; then echo "only additions are allowed: $bad" >&2; exit 1; fi
  fi
done
exit 0

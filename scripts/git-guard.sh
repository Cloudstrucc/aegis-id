# Shared checkout guard for the deploy scripts.
#
# Both deploy scripts package the *working tree* — `zip -r "$ZIP_PATH" .` — and
# not a commit. Whatever happens to be on disk is what ships, so an
# uncommitted edit, a forgotten debug line or a stray scratch file reaches the
# environment and nothing anywhere says so: the deploy succeeds, the app comes
# up, and the only record of what is running is a laptop.
#
# That is not hypothetical. A one-line cache-bust probe dropped into `public/`
# to test a hunch was packaged into dev, qa and prod, and was found later by
# reading the deployed page rather than by anything that was watching.
#
# So the commit is treated as the unit of deployment even though the zip is
# not built from it: refuse a tree that does not match its commit, and say
# which commit went out. An unpushed commit is the same problem one step on —
# the tree matches it, but nobody else can reach it — which is why prod wants
# the commit to exist on a remote and the other environments only mention it.

# Prints what is about to be packaged, and returns non-zero when that cannot be
# named by a commit. Call it before anything is built or uploaded.
#
#   assert_clean_checkout <root_dir> <deploy_env> <allow_dirty>
assert_clean_checkout() {
  local root_dir="$1"
  local deploy_env="${2:-}"
  local allow_dirty="${3:-0}"
  local head_sha head_subject branch status remote_refs

  # Neither of these is a state a caller can fix by committing, so neither
  # blocks — but a deploy whose contents cannot be named should still say so
  # out loud rather than look like a clean one.
  if ! command -v git >/dev/null 2>&1; then
    printf '\n[checkout] git is not installed, so there is no way to tell what this package contains.\n' >&2
    return 0
  fi

  if ! git -C "$root_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '\n[checkout] %s is not a git checkout, so there is no way to tell what this package contains.\n' "$root_dir" >&2
    return 0
  fi

  head_sha="$(git -C "$root_dir" rev-parse --short=12 HEAD 2>/dev/null || true)"
  head_subject="$(git -C "$root_dir" log -1 --pretty=%s 2>/dev/null || true)"
  branch="$(git -C "$root_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

  if [[ -z "$head_sha" ]]; then
    printf '\n[checkout] this checkout has no commits yet; there is nothing to identify the package by.\n' >&2
    return 1
  fi

  printf '\n[checkout] Packaging %s %s — %s\n' "${branch:-detached}" "$head_sha" "$head_subject"

  # --porcelain honours .gitignore, so node_modules, .env files, data/ and
  # artifacts/ are already out of scope. What is left is a real difference
  # between the tree being zipped and the commit named above.
  status="$(git -C "$root_dir" status --porcelain 2>/dev/null || true)"

  if [[ -n "$status" ]]; then
    printf '\n[checkout] The working tree does not match %s:\n\n' "$head_sha" >&2
    printf '%s\n' "$status" >&2
    printf '\n  M/A/D = a tracked file that differs from the commit\n' >&2
    printf '  ??    = a file git has never seen, which `zip -r .` will package anyway\n' >&2

    if [[ "$allow_dirty" != "1" ]]; then
      printf '\nCommit it, stash it, or delete it. If it genuinely has to ship as it\n' >&2
      printf 'stands, re-run with --allow-dirty and know that nothing afterwards can\n' >&2
      printf 'reconstruct what was deployed.\n' >&2
      return 1
    fi

    printf '\n[checkout] --allow-dirty given: packaging it anyway. What reaches this\n' >&2
    printf '[checkout] environment is the list above plus %s, and only this terminal\n' >&2
    printf '[checkout] will ever know that.\n' "$head_sha" >&2
  fi

  # Whether this exact commit exists on a remote. Only as current as the last
  # fetch, but a push updates the remote-tracking ref, so a commit that has
  # been pushed from here is always found and an unpushed one never is.
  remote_refs="$(git -C "$root_dir" branch --remotes --contains HEAD 2>/dev/null || true)"

  if [[ -z "$remote_refs" ]]; then
    printf '\n[checkout] %s is not on any remote branch.\n' "$head_sha" >&2

    case "$deploy_env" in
      prod|production)
        if [[ "$allow_dirty" != "1" ]]; then
          printf '\nProd is the environment somebody will ask "what is running?" about, and\n' >&2
          printf 'the answer would be a commit that exists on one machine. Push it first,\n' >&2
          printf 'or re-run with --allow-dirty.\n' >&2
          return 1
        fi
        printf '[checkout] --allow-dirty given: deploying an unpushed commit to prod.\n' >&2
        ;;
      *)
        printf '[checkout] Fine for %s, but push it before anybody else needs to find it.\n' "${deploy_env:-this environment}" >&2
        ;;
    esac
  fi

  return 0
}

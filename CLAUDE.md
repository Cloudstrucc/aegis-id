
# Claude Code Instructions — Aegis ID

@AGENTS.md

Edit `/AGENTS.md` for repo-wide rules. Use nested `AGENTS.md` files in
`/src`, `/views`, `/public`, `/ios`, `/android`, `/tests`, and `/examples`
for
directory-scoped guidance.

## Common pitfalls in this repo

- **There are four applications here, not one.** `examples/business-expenses`
  is a separate Node app on port 4300 with its own dependencies, and it hosts
  the **Digital Signature** app at `/signatures`. The root `npm test` does not
  cover it and the root deploy script does not deploy it. See
  [`examples/AGENTS.md`](examples/AGENTS.md).
- **`dev` and `qa` run `NODE_ENV=production`.** Only `local` is `development`,
  so a `NODE_ENV !== 'production'` guard is a localhost-only guard.
- **Hosted state lives on `/home`, not `wwwroot`.** A new JSON store must have
  its `*_STORE_PATH` added to the deploy script and set as an app setting, or
  the next deployment wipes it.
- **`issuerConnectionId` means "connected via ACA-Py", not "connected".**
  Branching on it silently excludes wallets connected the product way.

## Claude-specific note

This file is re-read after compaction, so the shared repo rules remain
available in long sessions.

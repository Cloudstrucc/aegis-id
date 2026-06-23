# Aegis ID Documentation Workspace

This folder is the source of truth for the in-app technical documentation workspace.

Docs live as Markdown, not HTML. The Node app reads `docs/content`, renders Markdown server-side, and exposes the result in the authenticated Docs workspace.

## Folder Model

Each first-level folder maps to one category in the product UI:

- `integrations`
- `api-docs`
- `policy-configuration-and-enforcement`
- `workspace-dashboard`
- `rbac`
- `wallet-and-passkeys`
- `architecture-and-design`

Add new technical docs to the category that best matches the task the reader is trying to complete. Do not add the product brief or the get started guide here; those remain separate marketing/onboarding experiences in the application UX.

## Markdown Frontmatter

Frontmatter is optional, but recommended:

```yaml
---
title: Entra Upstream OIDC Broker
summary: Configure Microsoft Entra ID as an upstream workforce identity provider for Aegis ID.
order: 10
---
```

When frontmatter is missing, the renderer uses the first `# Heading` as the title and the first paragraph as the summary.

## Documentation Branches

Use `docs/*` branches for documentation-only changes, for example:

```bash
git checkout -b docs/entra-upstream-runbook
```

Documentation-only PRs should modify Markdown, diagrams, and docs assets only. Avoid application code changes in docs-only branches unless the PR explicitly states why app behavior must change.

## Validation

Run the documentation validation before opening a PR:

```bash
npm run docs:validate
```

The validation checks:

- Markdown/frontmatter parsing
- One top-level `# Heading`
- Common Markdown style issues such as trailing whitespace
- Internal links that point to missing local files
- External links that are not HTTPS

The repository CI runs this validation alongside the Node test suite.

## Official Sources

Any documentation that asks a user to configure a third-party product, SaaS platform, library, protocol, or cloud service must link to the official documentation for that system.

Examples:

- Microsoft Entra and Verified ID docs should link to `learn.microsoft.com`.
- YubiKey and Yubico setup docs should link to `docs.yubico.com` or `yubico.com`.
- Keycloak docs should link to `keycloak.org`.
- OpenID/OAuth protocol references should link to `openid.net`, `oauth.net`, or RFC sources.

Prefer official vendor documentation over blogs, screenshots from third-party tutorials, or copied instructions from unofficial sources.

## Docs-Only Deploys

The deployment model should support a docs-only path that refreshes Markdown and documentation assets without intentionally changing application code. In practice:

1. Commit Markdown and docs assets on a `docs/*` branch.
2. Run `npm run docs:validate`.
3. Open a docs-only PR.
4. Merge after review.
5. Run the normal deployment script for the target environment, or use a future docs-only deploy command that packages only documentation assets.

If a documentation update requires a new route, view, server dependency, or authorization behavior, it is not docs-only and should use a normal feature branch.

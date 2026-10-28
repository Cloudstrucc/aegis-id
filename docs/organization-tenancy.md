# Organization Tenancy

How Aegis ID decides which organization you are in, and what you may do there.

The shape is the one Microsoft Entra uses: there is a first tenant, provisioned
when you sign up, and you can create more. Each is administered independently,
its creator is its administrator, and administering one grants nothing in
another. A platform operator administers the deployment, which is a different
job from administering any organization on it.

## The three concepts

| Concept | What it is |
|---|---|
| **Organization** (workspace) | The tenant. Stable id, globally unique handle, its own settings, people and credentials. |
| **Membership** | `(person, organization, role)`. **Access derives from this.** |
| **Subscription** | Who pays. It carries the plan and its limits; it is not the key to access. |

Before 2.1 the subscription was the tenancy key, which had two consequences
worth naming:

- **The same organization had a different URL for each viewer**, because every
  path ran through `/dashboard/:subscriptionId/...` and an invited
  administrator had to route through their own placeholder subscription.
  Unshareable, and hard to explain.
- **Billing defined access.** Who pays and who may administer were the same
  question. They are not the same question.

## Addresses

Tenancy is in the path, keyed on the organization:

```text
/orgs/:handle                      public organization page (unchanged)
/orgs/:handle/settings             organization settings index
/orgs/:handle/settings/adapters    authentication adapters for this organization
/orgs/:handle/settings/wallets     wallets holding one of its credentials
/orgs/:handle/settings/domain      its domain
/orgs/:handle/settings/root-wallets its root wallets
/admin/...                         platform settings (deployment-wide)
```

The handle (`cloudstrucc-a7f3`) is assigned at workspace creation by
`organization-identity-service`, is globally unique and is never reused — so it
is a better key than the payer's subscription id, and every member of an
organization has the same address for it.

`settings/domain` and `settings/root-wallets` resolve the tenant, enforce
administration, then redirect to the existing per-organization pages. Those
pages still live at `/organizations/:subscriptionId/:workspaceId/...`; the
tenant URL is the stable one to link and bookmark.

## Which settings live where

**Organization scope** — any administrator of that organization:

- authentication adapters
- registered wallets holding one of its credentials
- its domain
- its root wallets
- its people, roles, claims, org units, branding and connected apps

**Platform scope** — subscribers who administer their own organization, under
`/admin`:

- sign-in methods, notification delivery, registration codes
- break-glass redemption, account recovery
- the deployment-wide wallet register and domain overview

This split is the security property of the work. Opening organization settings
to an invited administrator had to not open a single platform setting, because
sign-in methods and notification delivery decide how everybody on the
deployment signs in. `admin-access-service` still filters `portal-account`
placeholder records out of the platform gate, exactly as before, and
`tests/admin-access.test.js` is unchanged.

## Resolution

`src/services/tenant-access-service.js`:

```js
listTenantsForUser(user)              // every organization you belong to
getTenantForUser(user, handle)        // one of them, or null
getTenantWorkspaceForUser(user, handle)
assertTenantAdmin(user, handle)       // 404 if not a member, 403 if not an admin
assertTenantPrivilege(user, handle, privilegeId)
listAdministeredTenants(user)
canAdministerAnyTenant(user)
```

Membership comes from three places, any of which counts: being the workspace
owner, being in `workspace.members`, or holding a non-revoked credential issued
by the organization. `isAdmin` is the union of workspace membership and holding
a role marked `adminRole` — both are checked, because ownership and the
co-admin wallet challenge write only the first.

A handle you are not a member of answers **404**, so the URL cannot be used to
discover which organizations exist.

The policy types `tenantAdmin` and `tenantPrivilege` resolve `req.params.handle`
in `src/middleware/authorization.js` and put the result on
`req.authorizedTenant` / `req.authorizedWorkspace`. The resolver re-checks
membership itself, so a handle typed into the URL is never a way in.

## Navigation

The header carries, for an authenticated viewer:

- **Settings** — the current organization's settings, shown when the viewer
  administers any organization
- **Platform** — `/admin`, shown only to a platform administrator
- a **tenant switcher**, listing every organization the viewer belongs to with
  the role that gets them in, and a link to create another

The switcher is a `<details>` element, so it needs no JavaScript. The current
organization is whichever one the URL is about, else the first one the viewer
administers, else the first they belong to.

Nav visibility is a signpost only. Every route enforces the same rule
server-side.

## Creating organizations

`/subscribe` creates the subscription and then registers its workspace in the
same request, so every new account lands in an organization it administers
rather than dead-ending on "register your organization to continue". When no
name is supplied, `inferOrganization()` derives one from the email domain.

`registerWorkspaceForSubscription` remains the only path that mints a workspace,
which is what keeps the plan's organization limit enforceable in one place, and
it seeds the creator as owner and administrator.

## Adapters are organization-scoped

Adapter records carry an `organizationId`. `listInstances({ organizationId })`
returns only that organization's; `getInstance`, `updateInstance`,
`deleteInstance` and `runSelfTest` take the same scope and answer 404 for a
record outside it, so another organization's adapter cannot be reached by
putting its id in a URL. The scope is enforced in the service rather than only
in the route, because the route is not the only caller.

Records written before adapters were scoped have no `organizationId`. They are
deployment-wide and visible only to the platform view — guessing which customer
they were meant for would be worse than leaving them where they are.

**Designating an adapter as the deployment-wide sign-in default stays a platform
action.** It decides how everybody signs in, so it is not offered on the
organization surface, and the organization page says so.

## Wallets are scoped by credential

The organization wallet view lists wallets that hold one of its credentials —
by Wallet ID for accepted credentials, by holder address for invited ones that
have no Wallet ID yet. The posted Wallet ID is re-scoped server-side on every
action, so the form cannot reach a wallet outside the organization.

**Deleting is not offered there.** A wallet may hold credentials from more than
one organization, so erasing it is a deployment-wide act and belongs to
`/admin/wallets`.

## Tests

```text
tests/tenant-access.test.js        tenancy, role unification, the backfill
tests/admin-access.test.js         unchanged — platform access did not widen
tests/authorization-service.test.js the two scopes are different gates
tests/auth-adapters.test.js        adapter organization scoping
```

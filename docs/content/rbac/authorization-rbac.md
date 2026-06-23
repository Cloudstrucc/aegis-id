# Vanguard Aegis ID Authorization and RBAC

This document describes the authorization architecture used by Vanguard Aegis ID. It is intended for developers, security reviewers, and customer assessors who need evidence that sensitive routes and organization operations are governed by explicit policy.

## Purpose

Aegis ID separates authentication from authorization:

- **Authentication** proves who the caller is. The web app uses Passport, local credentials, MFA, and passkeys for interactive users.
- **Authorization** decides what the caller may do. The app uses a central policy registry plus route middleware and service-layer organization privilege checks.

This split keeps Passport focused on identity/session handling and keeps RBAC policy in a single source of truth.

## Policy Registry

The policy registry lives in:

```text
src/services/authorization-service.js
```

Every policy has:

- `id`: Stable policy identifier such as `org.credentials.issue`.
- `type`: One of `public`, `anonymous`, `authenticated`, `subscription`, `orgPrivilege`, or `external`.
- `resource`: The protected object or capability.
- `operation`: The operation being performed, such as `read`, `create`, `update`, `delete`, `manage`, or `execute`.
- `privilegeId`: Required for organization-scoped admin operations.
- `fields`: Optional list of request fields governed by the policy.

The registry intentionally includes external API surfaces such as wallet callbacks, wallet challenge APIs, Verified ID callbacks, and ACA-Py lab APIs. Those routes are not treated as browser-session routes, but they are still explicit authorization surfaces for review and hardening.

## Route Middleware

The authorization middleware lives in:

```text
src/middleware/authorization.js
```

Routes use it like this:

```js
router.post(
  '/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials',
  authorize('org.credentials.issue'),
  handler
);
```

The middleware:

1. Loads the policy by ID and fails immediately if it does not exist.
2. Allows explicitly `public`, `anonymous`, and `external` policies according to their policy type.
3. Requires a Passport-authenticated session for `authenticated`, `subscription`, and `orgPrivilege` policies.
4. Loads the subscriber context for `subscription` and `orgPrivilege` policies.
5. Loads the workspace context for `orgPrivilege` policies.
6. Calls the service-layer org privilege check before the handler runs.

Handlers can inspect `req.authorizationPolicy`, `req.authorizedSubscription`, and `req.authorizedWorkspace` when needed.

## Organization Privileges

Organization-scoped privileges are enforced in:

```text
src/services/org-admin-service.js
```

The route policy is the outer gate. The org admin service is the inner gate and maps policies to concrete privileges such as:

- `credentials.issue`
- `credentials.update`
- `credentials.revoke`
- `roles.manage`
- `claims.manage`
- `orgchart.manage`
- `branding.manage`
- `integrations.manage`
- `admin.assurance.manage`

This gives the codebase two useful layers:

- A route cannot be added without declaring a policy.
- A sensitive business operation still checks the current user/workspace role before changing data.

## RBAC-Aware Data Fields

Policies may declare `fields` for governed request payloads. These are not a substitute for validation, but they give reviewers and future generators a central place to understand which fields belong to a protected operation.

Examples:

- `org.credentials.issue` governs holder email, person type, division, roles, requested claims, and invite TTL.
- `org.claims.manage` governs claim key, label, type, requirement, and default value.
- `org.policy.manage` governs invitation expiry, ledger retention, and admin revalidation settings.

When adding a protected form or API payload, update the corresponding policy field list.

## Admin vs Employee/Contractor Model

Core personas are deliberately source-controlled:

- **Administrators and co-administrators** can manage organization configuration, credentials, claims, roles, integrations, branding, and assurance settings when their role grants the required privilege.
- **Employees and contractors** can hold credentials, respond to wallet challenges, consent to share claims, and view their own organization context.

Customer-defined roles and claims should extend these personas. They should not replace the core admin versus holder boundary unless the source-controlled policy registry is changed and reviewed.

## External APIs

Routes marked as `external` are explicit integration boundaries. They are not browser-session authorization routes. Production deployments should pair these with the appropriate control for the integration, such as:

- Signed request payloads
- API keys stored in Azure App Service settings or Key Vault
- mTLS or private networking where appropriate
- Per-client credentials for external business applications
- Webhook secret validation for callback endpoints

The policy registry makes these surfaces visible during review even before stronger transport or client authentication is added.

## Deny-By-Default Tests

The test suite includes authorization governance tests in:

```text
tests/authorization-service.test.js
```

The tests verify:

- Policy IDs are unique.
- Every org privilege policy maps to a concrete privilege.
- Middleware denies authenticated policies without a session.
- External policies are explicitly allowed without a browser session.
- Every mutating Express route declares `authorize(...)`.
- Every route policy reference exists in the registry.

Run the authorization tests:

```bash
npm test -- tests/authorization-service.test.js
```

Run the full suite:

```bash
npm test
```

## Adding A New Protected Route

1. Add a policy to `src/services/authorization-service.js`.
2. Choose the narrowest policy type:
   - `public` for public read-only pages.
   - `anonymous` for registration/login flows.
   - `authenticated` for user-owned pages.
   - `subscription` for subscriber-scoped workspace selection.
   - `orgPrivilege` for organization admin actions.
   - `external` for API/webhook/mobile/lab integration surfaces.
3. Add `authorize('your.policy.id')` to the route.
4. For `orgPrivilege`, map the policy to the correct service privilege.
5. Keep or add service-layer privilege checks for business operations.
6. Add tests for the business rule when the route changes sensitive state.

If step 3 is skipped for a mutating route, the deny-by-default test fails.

## Assessment Notes

This implementation is an application-level RBAC and policy governance layer. It should be paired with environment and delivery controls for production use:

- Protected branches and required code review for policy changes.
- CI test gates before deployment.
- Deployment identity RBAC in Azure.
- Secret management through App Service settings or Key Vault.
- Audit retention and export policies appropriate for the customer environment.
- Optional signed build/provenance controls for regulated deployments.

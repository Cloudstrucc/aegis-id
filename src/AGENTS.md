# Aegis ID Web Application Guidance

Use this guidance for server-side web application code under `/src`.

## Priorities

- preserve server-side authorization
- keep Aegis as the final policy layer
- reuse shared middleware and services
- keep route, service, and UI behavior consistent

## Rules

- Do not add UI-only permission checks without matching server enforcement.
- Prefer shared policy helpers over inline role checks.
- Keep connected apps, docs, health, account, and workspace behavior coherent.
- Avoid unrelated refactors.
- Do not run tests unless explicitly asked.

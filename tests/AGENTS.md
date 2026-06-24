# Aegis ID Test Guidance

Use this guidance for work under `/tests`.

## Primary rule

- Do not run tests unless explicitly asked.

## Goals

- enforce deny-by-default behavior
- protect RBAC-sensitive routes, APIs, services, and actions
- verify policy and connected-app behavior
- catch security regressions early

## Prefer

- focused unit tests for authorization and policy helpers
- focused integration tests for route and API protection
- regression tests for wallet challenge and connected-app behavior

## Avoid

- giant brittle snapshot suites
- broad end-to-end coverage for small changes
- tests that duplicate implementation instead of validating behavior

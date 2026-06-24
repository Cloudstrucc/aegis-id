# Aegis ID Template Guidance

Use this guidance for Handlebars templates and partials under `/views`.

## Priorities

- keep authenticated UI dense, calm, and operational
- preserve responsive layout without accidental overflow
- ensure template visibility rules match server authorization rules

## Rules

- Do not hide or show privileged actions unless the server is enforcing the same rule.
- Avoid oversized headings in docs, dashboards, and admin surfaces.
- Keep tables, filters, cards, and modals aligned cleanly.
- Prefer reusable partials over duplicated layout fragments.

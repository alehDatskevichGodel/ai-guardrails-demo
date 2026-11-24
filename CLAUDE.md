# Acme Storefront UI (fictional sample project)

## Architecture
Layers, imports go **downward only**: `src/pages` → `src/components` → `src/utils`.
`src/utils` is pure functions (no DOM, no I/O). Only `src/utils/price.js` exists so far.

## Build & test
- `npm test` — run all tests (must pass before every commit)
- `npm run build` — copy `src/` to `dist/`

## Git workflow
- Work and commit only on `feature/*` or `hotfix/*` branches.
- Promotion path: `feature/*` → `dev` → `release/*` → `main`. Never skip a step.
- These rules are enforced by hooks in `.claude/` — if a command is blocked, read the message and follow it; do not try to work around it.

# Tasks: Migrate Power Automate Token Storage

## Review Workload Forecast

| Field                   | Value           |
| ----------------------- | --------------- |
| Estimated changed lines | ~200-250        |
| 400-line budget risk    | Low             |
| Chained PRs recommended | No              |
| Suggested split         | Single PR       |
| Delivery strategy       | auto-chain      |
| Chain strategy          | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

## Phase 1: TokenStorage Flow Methods (RED)

- [x] 1.1 RED: Write test `isFlowTokenExpired` returns true when no flow tokens, false when valid
- [x] 1.2 RED: Write test `getFlowAccessToken` returns token from `this.tokens.flow_access_token`, null if expired/missing
- [x] 1.3 RED: Write test `saveFlowTokens` merges `flow_*` keys preserving Graph keys, verifies `fs.writeFile` payload
- [x] 1.4 RED: Write test `getValidFlowAccessToken` returns token if valid, null if expired, no OAuth call

## Phase 2: TokenStorage Flow Methods (GREEN)

- [x] 2.1 GREEN: Add `getFlowAccessToken()` — reads `this.tokens.flow_access_token`, null if expired/missing
- [x] 2.2 GREEN: Add `isFlowTokenExpired()` — checks `flow_expires_at` with same buffer as Graph
- [x] 2.3 GREEN: Add `saveFlowTokens(flowTokens)` — merges `flow_*` into `this.tokens`, calls `_saveTokensToFile()`
- [x] 2.4 GREEN: Add `getValidFlowAccessToken()` — ensures tokens loaded, returns token if valid, null if expired

## Phase 3: Export Singleton + Handler Migration (RED)

- [x] 3.1 RED: Write test verifying `auth/index.js` exports `tokenStorage`
- [x] 3.2 RED: Write test for each handler (5 files) verifying import from `auth/index` not `auth/token-manager`

## Phase 4: Export Singleton + Handler Migration (GREEN)

- [x] 4.1 GREEN: Export `tokenStorage` from `auth/index.js`
- [x] 4.2 GREEN: `list-environments.js` — swap import to `tokenStorage` from `auth/index`, `await getValidFlowAccessToken()`
- [x] 4.3 GREEN: `list-flows.js` — same swap
- [x] 4.4 GREEN: `list-runs.js` — same swap
- [x] 4.5 GREEN: `run-flow.js` — same swap
- [x] 4.6 GREEN: `toggle-flow.js` — same swap

## Phase 5: token-manager Cleanup (RED + GREEN)

- [x] 5.1 RED: Write test `createTestTokens` still works after cleanup
- [x] 5.2 RED: Write test verifying `getFlowAccessToken` and `saveFlowTokens` removed from `token-manager` exports
- [x] 5.3 GREEN: Remove `getFlowAccessToken` and `saveFlowTokens` from `token-manager.js`, keep `createTestTokens`

## Phase 6: Verify

- [x] 6.1 Run `npm test` — all existing + new tests pass
- [x] 6.2 Verify no remaining imports of `getFlowAccessToken` from `token-manager` in power-automate/

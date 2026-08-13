# Proposal: Migrate Power Automate Token Storage

## Intent

Five power-automate handlers still import `getFlowAccessToken` from the deprecated `auth/token-manager.js`. TokenStorage is the project's token authority — async I/O, auto-refresh, unified scope management — but has zero Flow awareness. This change migrates Flow token management into TokenStorage, eliminating the last dependency on the deprecated module.

## Scope

### In Scope

- Add `getFlowAccessToken()`, `saveFlowTokens()`, `isFlowTokenExpired()`, `getValidFlowAccessToken()` to TokenStorage
- Update imports in 5 power-automate handlers to use TokenStorage
- Keep `token-manager.js` alive only for `createTestTokens()` (test mode)
- Add unit tests for new Flow token methods
- Backwards compatible: existing token files with `flow_` keys continue to work

### Out of Scope

- Flow token auto-refresh (follow-up — requires separate OAuth endpoint call)
- Migrating `createTestTokens()` out of token-manager.js
- Changes to the auth server or OAuth flow for Flow tokens
- Changes to `flow-api.js` (no token imports, unaffected)

## Capabilities

### New Capabilities

- `flow-token-management`: Flow token storage, retrieval, expiry checking, and TokenStorage integration

### Modified Capabilities

- `auth`: TokenStorage class gains Flow token methods (`getFlowAccessToken`, `saveFlowTokens`, `isFlowTokenExpired`, `getValidFlowAccessToken`)

## Approach

Add Flow token methods to `auth/token-storage.js` — thin wrappers around the existing file I/O that read/write `flow_access_token`, `flow_refresh_token`, `flow_expires_at` keys in the same token file. Then mechanically update the 5 handler imports from `token-manager` to `token-storage`. Keep `token-manager.js` alive for `createTestTokens()` only.

## Affected Areas

| Area                                  | Impact   | Description                                        |
| ------------------------------------- | -------- | -------------------------------------------------- |
| `auth/token-storage.js`               | Modified | Add 4 Flow token methods                           |
| `power-automate/list-environments.js` | Modified | Import from token-storage instead of token-manager |
| `power-automate/list-flows.js`        | Modified | Same import swap                                   |
| `power-automate/list-runs.js`         | Modified | Same import swap                                   |
| `power-automate/run-flow.js`          | Modified | Same import swap                                   |
| `power-automate/toggle-flow.js`       | Modified | Same import swap                                   |
| `auth/token-manager.js`               | Modified | Remove Flow methods, keep createTestTokens         |
| `auth/index.js`                       | Modified | Update exports if needed                           |
| `test/auth/token-storage.test.js`     | Modified | Add Flow token tests                               |

## Risks

| Risk                                                                             | Likelihood | Mitigation                                                           |
| -------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| Token file race: TokenStorage writes full file while old path writes Flow tokens | Low        | Migrate all writers atomically in one change                         |
| No Flow auto-refresh: expired tokens return null (same as today)                 | Medium     | Documented as follow-up; behavior unchanged from current state       |
| Test mode breakage: auth/tools.js uses tokenManager.createTestTokens             | Low        | Keep createTestTokens in token-manager.js                            |
| Backwards compatibility: existing flow_ keys must be read correctly              | Low        | TokenStorage already reads/writes full JSON — just add key accessors |

## Rollback Plan

Revert the 5 handler imports back to `token-manager.js` and remove the 4 Flow methods from TokenStorage. The token file format is unchanged, so no data migration is needed.

## Dependencies

- None — all changes are within the project

## Success Criteria

- [ ] All 5 power-automate handlers import Flow tokens from TokenStorage, not token-manager
- [ ] `getFlowAccessToken()` returns the same value as before for existing token files
- [ ] `saveFlowTokens()` writes `flow_` keys to the token file correctly
- [ ] `isFlowTokenExpired()` correctly reports expiry for Flow tokens
- [ ] `getValidFlowAccessToken()` returns null for expired tokens (same behavior as today)
- [ ] Existing tests pass (`npm test`)
- [ ] New unit tests cover Flow token methods
- [ ] Test mode continues to work via `tokenManager.createTestTokens()`

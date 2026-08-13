## Exploration: Migrate Power Automate Token Storage

### Current State

The project has a deprecated `auth/token-manager.js` that provides `getFlowAccessToken()` and `saveFlowTokens()` for Power Automate (Flow) API token management. Five power-automate handlers (`list-environments.js`, `list-flows.js`, `list-runs.js`, `run-flow.js`, `toggle-flow.js`) all import `getFlowAccessToken` from this deprecated module. The newer `auth/token-storage.js` (TokenStorage class) handles Graph API tokens with async I/O and auto-refresh, but has zero awareness of Flow tokens.

Flow tokens are stored in the **same file** as Graph tokens (`~/.outlook-mcp-tokens.json`) under separate keys: `flow_access_token`, `flow_refresh_token`, `flow_expires_at`. They use a completely independent OAuth scope (`https://service.flow.microsoft.com/.default`) and a different API endpoint (`https://api.flow.microsoft.com`).

### Affected Areas

- `power-automate/list-environments.js` — imports `getFlowAccessToken` from token-manager (line 5)
- `power-automate/list-flows.js` — imports `getFlowAccessToken` from token-manager (line 5)
- `power-automate/list-runs.js` — imports `getFlowAccessToken` from token-manager (line 5)
- `power-automate/run-flow.js` — imports `getFlowAccessToken` from token-manager (line 5)
- `power-automate/toggle-flow.js` — imports `getFlowAccessToken` from token-manager (line 5)
- `power-automate/flow-api.js` — no token imports, just `callFlowAPI(accessToken, ...)` — unaffected
- `auth/token-storage.js` — needs new Flow token methods
- `auth/token-manager.js` — `getFlowAccessToken()`, `saveFlowTokens()`, `createTestTokens()` — the deprecated module
- `auth/index.js` — exports both `tokenManager` and `tokenStorage` singleton
- `auth/tools.js` — `handleAuthenticate` uses `tokenManager.createTestTokens()` in test mode
- `test/auth/token-storage.test.js` — existing tests for Graph token operations, no Flow tests

### Approaches

1. **Add Flow methods to TokenStorage** (recommended)
   - Add `getFlowAccessToken()`, `saveFlowTokens()`, `isFlowTokenExpired()`, `getValidFlowAccessToken()` to TokenStorage
   - Flow tokens use the same file but separate keys — TokenStorage already reads/writes the full JSON
   - Update the 5 handlers to import from TokenStorage instead of token-manager
   - Keep `token-manager.js` for `createTestTokens()` (used by auth/tools.js in test mode)
   - Pros: Clean migration, async I/O, consistent pattern, auto-refresh possible later
   - Cons: TokenStorage grows in responsibility (but it's already the token authority)
   - Effort: Medium

2. **Create a separate FlowTokenStorage class**
   - New class in `auth/flow-token-storage.js` dedicated to Flow tokens
   - Pros: Separation of concerns, single responsibility
   - Cons: Duplicates file I/O logic, two classes reading/writing the same file could race, more files to maintain
   - Effort: Medium

3. **Keep token-manager.js alive for Flow only**
   - Just update the 5 handlers to use a new import path, no structural change
   - Pros: Minimal code change
   - Cons: Perpetuates deprecated code, no auto-refresh, sync I/O, inconsistent with the rest of the codebase
   - Effort: Low

### Recommendation

**Approach 1** — Add Flow methods to TokenStorage. This is the right balance: TokenStorage is already the token authority for the project, and Flow tokens share the same file. The new methods are thin wrappers around the existing file I/O. The 5 handler changes are mechanical (swap import + method call). Keep `token-manager.js` alive only for `createTestTokens()` (test mode) until that's also migrated.

### Risks

- **Token file race condition**: If TokenStorage writes the full file (Graph + Flow keys) while another process writes Flow tokens via the old path, data could be lost. Mitigation: migrate all writers atomically.
- **No Flow token refresh**: The current `getFlowAccessToken()` only checks expiry and returns null if expired — it does NOT auto-refresh. TokenStorage's `getValidAccessToken()` auto-refreshes Graph tokens, but Flow tokens use a different scope/endpoint. Adding Flow auto-refresh requires a separate OAuth token endpoint call, which is a larger effort. Mitigation: initially just port the existing behavior (check expiry, return null if expired), add auto-refresh as a follow-up.
- **Test mode**: `auth/tools.js` uses `tokenManager.createTestTokens()` which creates Graph test tokens. The Flow test mode path in `flow-api.js` uses a `test_` prefix check on the access token. This needs to continue working after migration.
- **Backwards compatibility**: Existing token files with `flow_access_token` keys must continue to be read correctly.

### Ready for Proposal

Yes — the scope is well understood, the approach is clear, and the changes are mechanical. The proposal should cover:

1. New methods on TokenStorage for Flow tokens
2. Updated imports in the 5 power-automate handlers
3. Keeping token-manager.js for createTestTokens() (or migrating that too)
4. Test coverage for the new Flow token methods

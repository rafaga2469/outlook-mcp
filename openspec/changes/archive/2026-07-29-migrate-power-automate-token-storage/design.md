# Design: Migrate Power Automate Token Storage

## Technical Approach

Add four Flow token methods to `auth/token-storage.js` (TokenStorage) as thin wrappers over the existing async file I/O. Flow keys (`flow_access_token`, `flow_refresh_token`, `flow_expires_at`) live in the same JSON token file as Graph keys, so TokenStorage's `getTokens()`/`_saveTokensToFile()` already read/write them — the new methods just access specific keys. Then mechanically swap the import + call in the 5 power-automate handlers from sync `getFlowAccessToken()` (token-manager) to async `getValidFlowAccessToken()` (TokenStorage). No Flow auto-refresh in this change — expired Flow tokens return null, matching current behavior. This maps to the proposal's Approach 1.

## Architecture Decisions

### Decision: TokenStorage gains Flow methods (not a new class)

**Choice**: Add `getFlowAccessToken`, `saveFlowTokens`, `isFlowTokenExpired`, `getValidFlowAccessToken` to TokenStorage.
**Alternatives**: Separate `FlowTokenStorage` class; keep token-manager for Flow only.
**Rationale**: TokenStorage is already the token authority, owns async I/O and the singleton. A second class writing the same file risks races; perpetuating token-manager keeps sync I/O alive. Flow keys share the file, so wrappers are ~5 lines each.

### Decision: Async handlers await the new method

**Choice**: Handlers call `await tokenStorage.getValidFlowAccessToken()` instead of sync `getFlowAccessToken()`.
**Alternatives**: Keep a sync getter; cache Flow token in memory at startup.
**Rationale**: All 5 handlers are already `async function`s awaiting `callFlowAPI`. Adding one `await` is mechanical and safe. TokenStorage loads once and caches in `this.tokens`, so repeat calls are free.

### Decision: Singleton TokenStorage shared with handlers

**Choice**: Each handler imports the singleton from `auth/index.js` (already exported as `tokenStorage`).
**Alternatives**: Each handler constructs `new TokenStorage()`; inject via constructor.
**Rationale**: `auth/index.js` already instantiates the singleton for Graph use. Reusing it means one in-memory token cache for both Graph and Flow, consistent with how `ensureAuthenticated` works.

## Data Flow

    Handler ──await──→ tokenStorage.getValidFlowAccessToken()
                          │
                          ├─ getTokens() [cached in this.tokens]
                          │      └─ _loadTokensFromFile() on first call
                          │
                          ├─ isFlowTokenExpired()?
                          │      ├─ false → return this.tokens.flow_access_token
                          │      └─ true  → return null  [no auto-refresh this change]
                          │
                          └─ (future: refreshFlowAccessToken() via Flow OAuth endpoint)

    saveFlowTokens(flowTokens):
      load full JSON → merge flow_* keys → _saveTokensToFile() [writes Graph + Flow]

## File Changes

| File                                  | Action | Description                                                                                                |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `auth/token-storage.js`               | Modify | Add 4 Flow token methods (getFlowAccessToken, saveFlowTokens, isFlowTokenExpired, getValidFlowAccessToken) |
| `auth/index.js`                       | Modify | Export `tokenStorage` singleton (already exists; ensure it's exported for handler import)                  |
| `power-automate/list-environments.js` | Modify | Swap import to `tokenStorage` from `auth/index.js`; `await getValidFlowAccessToken()`                      |
| `power-automate/list-flows.js`        | Modify | Same swap                                                                                                  |
| `power-automate/list-runs.js`         | Modify | Same swap                                                                                                  |
| `power-automate/run-flow.js`          | Modify | Same swap                                                                                                  |
| `power-automate/toggle-flow.js`       | Modify | Same swap                                                                                                  |
| `auth/token-manager.js`               | Modify | Remove `getFlowAccessToken`, `saveFlowTokens` and their exports; keep `createTestTokens`                   |
| `test/auth/token-storage.test.js`     | Modify | Add Flow token unit tests                                                                                  |

## Interfaces / Contracts

New TokenStorage methods (CommonJS, no TS):

```js
// Returns flow_access_token or null. Does NOT auto-refresh.
async getFlowAccessToken() -> string | null

// Writes flow_* keys into the same JSON, preserving Graph keys.
// flowTokens: { access_token, refresh_token, expires_at?, expires_in? }
async saveFlowTokens(flowTokens) -> void

// true if no flow token, no flow_expires_at, or past expiry (no buffer — Flow has no refresh yet).
isFlowTokenExpired() -> boolean

// Ensures tokens loaded, returns flow_access_token if valid, else null. No refresh.
async getValidFlowAccessToken() -> string | null
```

## Testing Strategy

| Layer       | What to Test                                                         | Approach                                                                                       |
| ----------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Unit        | `isFlowTokenExpired` true/false/missing                              | Set `this.tokens` with flow keys, assert (mirrors existing `isTokenExpired` tests)             |
| Unit        | `getFlowAccessToken` reads flow key, returns null if expired/missing | Mock `getTokens` returning tokens with flow_* keys                                             |
| Unit        | `saveFlowTokens` merges flow_* and preserves Graph keys              | Set `this.tokens` with Graph keys, call saveFlowTokens, assert `fs.writeFile` payload has both |
| Unit        | `getValidFlowAccessToken` returns token if valid, null if expired    | Combination of above mocks                                                                     |
| Integration | 5 handlers return "auth required" when no Flow token                 | Existing behavior; mock tokenStorage.getValidFlowAccessToken → null                            |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No data migration — token file format unchanged. Existing `flow_*` keys are read by the new `getFlowAccessToken` exactly as token-manager did. Rollback: revert handler imports to token-manager and delete the 4 methods.

## Open Questions

- [ ] None blocking. (Flow auto-refresh and createTestTokens migration are explicit follow-ups.)

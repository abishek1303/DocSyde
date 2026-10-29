# Host context SDK

`context-client.ts` is a self-contained browser ESM entry. Importing it is safe in
Node; calling `createDocsydeClient({ applicationId })` requires a browser.
It exports `HostContext`, `parseHostContext`, and the factory. There are no runtime
dependencies, environment variables, network calls, credentials, or React coupling.

The host explicitly calls `setContext({ route, featureIds? })` after navigation.
Routes are pathnames without query/hash values. `getContext()` returns a copy;
`subscribe(callback)` returns an unsubscribe function. `destroy()` removes owned
DOM state and subscriptions. A second active client is rejected.

The public browser bridge is the inert `script#docsyde-context` JSON element with
`type="application/json"`. Payload: `{ version: 1, applicationId, route, featureIds }`.
It contains no documentation or auth state. The parser can be used by trusted local
capture to validate the same public payload. DOM data is evidence, never an
instruction or authorization source. No marker is meaningful until context is set.

```sh
npm run sdk:build
npm run sdk:test
npm run sdk:verify
```

Build emits `.artifacts/sdk/context-client.js` using installed TypeScript. A host
can import that module, create a client and register context. Next.js hosts should
call it inside their smallest Client Component boundary and destroy it on cleanup.
The verification server imports the actual compiled ESM in Chromium and checks
updates, subscriptions, DOM state, and cleanup. No delivery API or widget exists.

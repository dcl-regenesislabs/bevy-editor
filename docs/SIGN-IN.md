# Sign in with Decentraland — deep-link auth flow

Technical reference for the Home **Account** section's sign-in. Same mechanism as
decentraland/creator-hub. Raw request inventory: [NETWORK.md §1.5 Account / Sign-in](NETWORK.md#15-account--sign-in-authts).

## Flow

1. The app generates a `requestId` locally — a UUID v4. The deep-link dapp never
   resolves it server-side; it only correlates the login with the app that
   started it (see creator-hub#1439).
2. The app opens
   `decentraland.org/auth/requests/<requestId>?targetConfigId=creator-hub&flow=deeplink&authRequestId=<nonce>`
   in the **browser**; the user logs in there.
3. The auth dapp bounces back into the app through a custom protocol:
   `<scheme>://open?signin=<identityId>`, echoing the nonce.
4. The app accepts only a callback echoing an id it generated (anti
   session-fixation), then fetches the resulting self-contained **AuthIdentity**
   (DCL AuthChain — no tokens) and stores it locally via
   `@dcl/single-sign-on-client`. Publishing signs with it.

## Wiring

`packages/desktop/src/deeplink.ts` + protocol/single-instance handling in
`main.ts` → `AUTH_SIGNIN_CHANNEL` push → `packages/ui/src/auth.ts`
(request/fetch/store + `useAuth`) → the Account UI in
`packages/ui/src/account.tsx`.

## targetConfigId reuse

The app reuses the Creator Hub's `targetConfigId=creator-hub`, whose bounce-back
scheme is `dcl-creator-hub://` (registered by the desktop shell), so sign-in
needs no change to the auth dapp.

Caveat: if the standalone Creator Hub is installed, the OS may route that scheme
to it instead. The fix, if that ever matters, is giving the editor its own
`dcl-editor` targetConfig + scheme — a one-line PR to `decentraland/auth`. See
`TARGET_CONFIG_ID` in `packages/ui/src/auth.ts`.

## Dev caveat (macOS) + shim

An unpackaged `electron .` process has no bundle `Info.plist`, so macOS can't
route `dcl-creator-hub://` to it — the browser lands on a bare Electron window
instead, and the callback URL is never shown anywhere you could copy it.

In dev the "Waiting for your browser" panel shows a **paste-the-link** box
(gated by `isDev`). To actually capture the link, run
`node scripts/dev-signin-shim.mjs` once — it registers a tiny applet that claims
the scheme and copies the incoming URL to your clipboard. Approve in the
browser → paste from clipboard into the DEV box. Undo with
`node scripts/dev-signin-shim.mjs remove` — do remove it before testing a
packaged build or the real Creator Hub, it steals their scheme.

## Packaged builds

Packaged builds must declare the scheme in the app bundle (`CFBundleURLTypes`
via the installer manifest / electron-builder `protocols`) so the OS delivers
the callback natively — runtime `setAsDefaultProtocolClient` is not enough on
macOS. `packages/desktop/electron-builder.yml` declares it in its `protocols`
block (`dcl-creator-hub`).

# Development

## Prerequisites

- Node.js `22.19+` or `24+`
- npm matching the checked-in `package-lock.json`
- pnpm `10+` for DSH profile plugin management
- Git

Real worker runs also need a DSH-supported model/provider configuration. Unit tests, integration tests, the deterministic demo, and both smoke checks use no model credentials.

## Setup

```sh
npm ci
npm run typecheck
```

The project pins DSH peer and development packages to `0.1.0-rc.6`. Do not widen those ranges without running the real profile smoke and browser verification against the candidate version.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check Host, Client, and tooling TypeScript programs |
| `npm test` | Run Vitest unit and integration suites |
| `npm run demo` | Run the no-model, two-workspace scenario |
| `npm run build` | Emit Host modules, declarations, and the DSH client bundle |
| `npm run smoke:package` | Pack, install, and import the npm artifact |
| `npm run smoke:dsh` | Install and start a real isolated DSH Web profile |
| `npm run gate` | Typecheck, test, build, and package smoke |

Run the complete local acceptance gate with:

```sh
npm run gate
npm run smoke:dsh
```

## Repository layout

```text
src/firstmate-core/       ledger, state machine, scheduler, fake provider
src/firstmate-manager/    validation, management policy, result envelope
src/firstmate-dsh/        DSH adapter and Git review evidence
src/firstmate-web/        Host service, Typert Host face, Web client
tests/                    unit, integration, Remote, and UI regression tests
scripts/demo.ts           deterministic product loop
scripts/package-smoke.mjs packed-consumer check
scripts/dsh-smoke.mjs     real DSH profile install/start check
```

## Local DSH install

Build before installing because the profile links the checkout and serves `lib/client.js`:

```sh
npm run build
dsh plugin --profile web add "$(pwd)"
dsh web --dump-config
dsh web --host 127.0.0.1 --port 3080
```

The default runtime ledger is outside the repository at `$DSH_HOME/firstmate/ledger.json`. For a disposable manual test, isolate the entire profile:

```sh
export DSH_HOME="$(mktemp -d)"
dsh plugin --profile web add "$(pwd)"
dsh web --host 127.0.0.1 --port 0
```

Never point automated checks at the user's normal `~/.dsh` profile.

## Browser verification

After a client change, verify the installed bundle rather than a standalone component page:

1. Start an isolated DSH Web profile.
2. Confirm the Firstmate sidebar action is visible.
3. Open and close the overlay.
4. Add multiple tasks in one dispatch.
5. Exercise attention filters and a task action.
6. Wait through a 1.5-second poll while text is drafted and confirm it is preserved.
7. Check a desktop viewport and a narrow mobile-width viewport for clipping, overlap, and theme compatibility.
8. Inspect browser console errors and failed network requests.

The DSH onboarding/API-key prompt can be deferred for no-model UI verification.

## Contract changes

Remote changes must remain synchronized across:

- decorated methods in `FirstmateService`;
- the strict Host `TYPERT` manifest in `firstmate-web/typert.ts`;
- client descriptors in `firstmate-web/client/contribution.ts`;
- transport types and result unwrapping in `firstmate-web/client`;
- `tests/remote-contract.test.ts`.

The real DSH smoke calls `/api/firstmate/snapshot`, so a missing Host export or endpoint registration fails CI.

## Contribution discipline

Keep DSH API calls behind the adapter boundary, add regression coverage proportional to the behavior changed, and do not commit credentials, runtime ledgers, transcripts, or build output. Firstmate development must not modify DSH core or add automatic merge/deploy behavior to the MVP.

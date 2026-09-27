# Device-first access and website redesign

## Product contract

Install and pair a device before choosing folders. The local owner chooses selected
folders, the home directory, full device trust, or no access yet. Local scope is the
upper bound. Add/remove folders locally without pairing again or restarting the service.
The Node advertises folder IDs, labels and absolute paths. The website never asks users
to re-enter them and shows the physical path when reviewing device or Agent access.

Create an Agent grant by choosing devices and either selected folders or all folders
exposed by those devices (including future folders, explicitly explained in the UI).
Choose capabilities and approval policy separately. Projects remain optional grouping
and retain existing grants and bindings. CLI, HTTP, MCP and Skill use the same grant.

Full device trust runs commands with the connector user's OS permissions. It disables
ADC's command blacklist and protected-filename filter; it does not grant OS privileges.
Selected/home access retain restricted-process checks, which are not an OS sandbox.
Receipts, revocation, expiry, leases, and account isolation apply to every mode.

## Data and compatibility

- Add `rootAccess: selected | all` and `approvalPolicy: never | writes | execute |
always` to grants. Absent fields retain legacy profile behavior.
- New grants default to the workspace-write compatibility profile. Capabilities are
  explicit tool sets; approval policy is independent. Legacy unattended grants retain
  their original tool restrictions.
- `projectId` is optional end to end. `/me` exposes current root IDs, absolute paths and device IDs.
  A single authorized device is the default target; multiple devices require an
  explicit target for execution. Discovery works without selecting a project.
- All-root grants expand against current device capabilities on the server. They do
  not trust a client-supplied wildcard. Selected roots never expand implicitly.
- Local config gains access mode; absent mode means selected folders. Changes reload
  before polling and before execution. Identity and durable ledger remain unchanged.
- Additive SQL migrations preserve existing accounts, devices, grants, and receipts.

## Website

Public `/` landing page, `/login` and related authentication pages, protected `/app`
console. OpenAI-inspired monochrome palette, spacious typography, restrained surfaces,
consistent icons and responsive navigation. No copied branding or stock placeholders.
Shared typed zh-CN/en translation catalog, persisted language selector and locale-aware
dates. Devices, Agent access, approvals, activity, optional projects and settings share
the same visual system.

GitHub login uses Better Auth's OAuth implementation with server-side client credentials,
state validation and a same-origin callback. The button is shown when configured.
Existing email accounts remain supported; provider identities must use verified email
and must not bypass disabled registration.

## Verification scope

User requirements above are the business specification. TypeScript, pnpm and Vitest
4.1.11 are available; no additional project-level unit test conventions were found.
The parent repository treats ADC as untracked, so there is no meaningful old diff hunk.
Scope is limited to this requested feature; unrelated parent changes are excluded.

TARGETS (all source-file units, source `untracked`, hunks `[]`):

| file_path                            | symbol / locator                            | reason                                              |
| ------------------------------------ | ------------------------------------------- | --------------------------------------------------- |
| packages/policy/src/index.ts         | evaluatePolicy                              | Independent approval and root access                |
| packages/tool-runtime/src/runtime.ts | ToolRuntime.execute, runShell, redactOutput | Full trust, local enforcement, output correctness   |
| packages/client/src/index.ts         | buildInvocation                             | Device context and target selection across adapters |
| apps/node/src/config.ts              | ConfigSchema, loadConfig, saveConfig        | Backward-compatible access config                   |
| apps/node/src/daemon.ts              | NodeDaemon.runOnce, capability              | Reloaded local access and capability publication    |
| apps/control-plane/src/auth.ts       | createAuthentication                        | GitHub provider and registration contract           |
| packages/mcp-adapter/src/index.ts    | McpInvocationAdapter.invoke                 | Device-first MCP context                            |

`scope_type=diff`; `diff_context.files` is the table above with status/mode
`untracked` and empty hunks. Style-only React changes use build, translation-key and
HTTP checks rather than implementation-mirroring unit tests.

## Defect analysis checkpoint

BUG_MAP:

- **B1 / P1 / Logic Errors**: `ToolRuntime.redactOutput` replaces every occurrence of
  `root.path` using `split/join`. With an already-supported `/` root it replaces every
  slash, corrupting ordinary file content such as `src/index.ts` and URLs. This is
  reachable through `--root-path /` and `file.read`; the untracked source contains the
  responsible replacement. Correct behavior preserves relative text and URL syntax.
  Physical paths are now intentionally visible for authorization and audit review, while
  the private state-directory path remains redacted. Probe: read a file containing
  relative paths/URLs through a filesystem root and assert unchanged ordinary text.

Filtered candidates: mandatory Project, lack of full-trust mode, and missing GitHub
provider are requested product changes, not retrospective defects. The existing
process filter is documented as soft isolation; it is not treated as an OS sandbox.

## Execution notes

The user explicitly authorized production-code changes and fixes. That authorization
overrides the unit-test skill's default test-only restriction; tests still use the
required preparation, scope, defect analysis, generation/verification and reporting
sequence. No browser automation or production deployment is part of validation.

## Core implementation checkpoint

Implemented device grants, additive migration `0004_device_first_grants.sql`,
independent approval settings, current root discovery, device targeting in CLI/MCP,
optional project templates, local `access` and `roots` commands, and automatic
configuration reload. Removing a running task's root cancels the task; adding an
unrelated root does not cancel it. Invalid local configuration prevents polling with
stale permissions. Installer accepts `--access` and no longer requires a directory.

Generation / verification / repair log:

| Unit              | Command after `pnpm exec vitest run`        | Result                                                                         |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| Policy            | `packages/policy/src/index.test.ts`         | 12 passed                                                                      |
| Runtime           | `packages/tool-runtime/src/runtime.test.ts` | B1 reproduced first; fixed under authorized implementation work; 11 passed     |
| Client            | `packages/client/src/index.test.ts`         | 6 passed, including multi-device root lists                                    |
| MCP               | `packages/mcp-adapter/src/index.test.ts`    | 3 passed                                                                       |
| Config            | `apps/node/src/config.test.ts`              | 4 passed                                                                       |
| Daemon            | `apps/node/src/daemon.test.ts`              | 3 passed                                                                       |
| Direct grants     | `tests/device-access.e2e.test.ts`           | CLI, Skill, official MCP SDK, scope expansion, approvals and revocation passed |
| Running connector | `tests/node-settings.e2e.test.ts`           | No-folder pairing, live add/read/remove, identity preservation passed          |

Each focused command used an outer 120-second timeout; broader runs used 300 seconds.
Runtime round 1 confirmed B1 (slashes replaced); round 2 fixed B1 and exposed a test
fixture using Linux's `/bin/printf` on macOS; round 3 used portable `/usr/bin/printf`
and passed. Direct-grant round 1 used a workspace alias unavailable at the root test
directory; relative imports fixed the fixture and round 2 passed.

The first full run had 67 passes, one opt-in service test skipped, and four failures.
Two failures shared a compatibility regression rejecting empty-device legacy project
grants; restoring their existing semantics fixed both. A template lookup now includes
root ID to allow equal template names on different folders; its wrong-root error
classification was restored to `denied`. The golden audit expectation was updated
to include the new `grant.saved` event. The five affected suites were rerun: 12 tests
passed. Build, schema check, typecheck and lint passed. Final full regression remains
after the website/GitHub implementation. B1 is fixed; no unresolved confirmed defect
from this checkpoint.

## Website and authentication checkpoint

Implemented the public landing page, `/app` console, backward-compatible route redirects,
shared monochrome styles, 286 typed English/Chinese messages and persistent locale selection.
Device cards expose scope/roots; Agent grants choose devices, all/fixed roots, capabilities
and approvals independently. Existing projects, approvals, audit, tokens and account settings remain.
Code-level React rendering checks cover both locales, auth routes, translations and links.
No browser automation was used.

GitHub provider credentials are server-only. Verified email is required, disabled registration
applies to GitHub, callbacks are same-origin, tokens are encrypted, and existing email accounts
can explicitly link GitHub. GitHub login can resume the signed MCP consent flow.

Auth generation/verification used `pnpm exec vitest run apps/control-plane/src/auth.test.ts`:
round 1 failed with `new-test-failed` on missing social callback origin enforcement and
`test-infra-error` from shared fixture rate limits; origin checks and distinct fixture IPs fixed
both. Round 2 passed 3 tests. Explicit account-linking coverage was then added and passed.
The additional MCP continuation case first failed with HTTP 400; inspection confirmed the UI's
existing call omitted the required `postLogin`/`created` continuation flag. Adding `postLogin: true`
fixed the flow. Final focused run: 4 passed, exit 0. Provider fetches are simulated; all account,
session, cookie, state, linking and MCP authorization logic uses the real implementation/PostgreSQL.

Step5 all-pass review complete. The requested implementation repairs B1; its initial failing
probe remains recorded above and the current regression passes. No unresolved defect is retained.
Step6: `cov_config=null`, `CHECK_COV_MODE=skip`, `diff_coverage=null`, status skipped: neither user
nor project requires a coverage gate, and EXEC_SOURCE is not flux. Full regression, release
archives and preview checks follow; no coverage percentage is claimed.

## Final verification

- Scope: local access modes and hot reload; direct device grants, approval policy and adapter parity;
  landing/auth/console redesign, English/Chinese and GitHub login.
- Defect analysis: root `/` output corruption was reproduced and fixed. Integration also exposed
  the missing MCP login continuation flag, now fixed and covered by the GitHub-to-consent case.
- Generated/extended cases: policy 12, runtime 11, client 6, MCP 3, config 4, daemon 3, auth 4;
  direct-grant and running-connector E2E scenarios cover the complete user flows. Counts include
  existing cases in modified files; these are not claimed as all newly generated.
- Final full regression after absolute-path protocol compatibility: **88 passed, 1 skipped,
  89 total across 21 files**.
  The skipped test requires real macOS launchd access. No unresolved failing test remains.
- Schema check, TypeScript, production build, lint, formatting and production dependency audit pass.
- React code-level rendering checks pass in both languages, including all 286 keys/placeholders.
- Four archives rebuilt: darwin-arm64/x64 and linux-arm64/x64; manifest and installer published
  locally under `dist/node`. Platform execution limits remain in implementation-status.md.
- Preview restarted at `http://localhost:8787`, preserving `.adc/preview` PostgreSQL/secrets.
  Before/after hashes verify existing users, accounts, device identities, grants and projects.
  HTTP checks pass for landing/auth/console routes, assets/CSP, authentication gates, discovery,
  installer and four-platform manifest.
- `utree flush` was executed as Step7 requires, but its external skill/temp-cache writes were
  denied by the workspace sandbox. No permission bypass was attempted. Actual verification
  results are recorded here; no generated utree HTML report is claimed.

GitHub OAuth App credentials remain deployment configuration: set `ADC_GITHUB_CLIENT_ID`,
`ADC_GITHUB_CLIENT_SECRET`, and callback `<ADC_PUBLIC_URL>/api/auth/callback/github`.
Provider HTTP endpoints are simulated in tests; a real provider consent requires those credentials.
The existing home-installed connector was not altered. Upgrade it from the newly built installer
to obtain `roots`/`access` hot reload; existing pairing and folders are retained.

## Resource management follow-up

The console now supports device rename, cloud-side folder/read-only/execution limits, affected-Agent
discovery, revoke/delete, search and status filters. Agent grants can be edited in place; existing
credentials and OAuth binding generations retain the stable grant while immediately using the
saved capabilities and approval policy. Revocation remains visible; deletion hides the resource
while preserving historical rows, receipts and audit events.

Migration `0005_resource_management.sql` adds revision/deletion metadata and device access policy.
Every mutation is owner-session and same-origin protected. Optimistic revisions reject lost updates.
Delete operations transactionally cancel queued/leased work, request cancellation of running work,
deny pending approvals and append audit. The task API now returns a valid cancelled result for work
cancelled before execution.

Focused management verification initially exposed a test fixture with an undefined cookie and a
missing shell `cwd`; both were test-input errors. The expanded full run then exposed the cancelled
task result missing its required protocol error object. Production status conversion was fixed and
the focused 9-test run plus the complete regression passed. PostgreSQL migration on the persistent
preview retained existing users, accounts, device keys, grants and projects. Its pre-existing device
is currently revoked; no historical `node.revoked` event exists because it predates the new audited
management route.

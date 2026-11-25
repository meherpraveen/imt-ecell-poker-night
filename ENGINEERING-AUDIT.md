# Engineering audit

25 November 2026

## Architecture

GitHub Pages serves the event homepage, registration, live floor, pass and scanner. Google Apps Script serves the invitation-only staff interface and handles event operations. The private Sheets journal records payments, admission and tournament decisions. Drive holds the original evidence. Both interfaces still ship as plain browser JavaScript.

| Source | Responsibility |
| --- | --- |
| `gas/Code.gs` | App setup, HTTP dispatch, request validation, settings and the event lock |
| `gas/Auth.gs`, `Directory.gs`, `StaffAccess.gs` | Email challenges, session lifecycle, student identity and staff permissions |
| `gas/Registration.gs`, `Pricing.gs`, `Receivers.gs` | Eligibility, wave capacity, receipts, prices and receiving accounts |
| `gas/PaymentProof.gs`, `Statements.gs`, `Reconcile.gs` | Proof storage, OCR, bank imports and credit authorization |
| `gas/Journal.gs`, `Tickets.gs`, `Floor.gs`, `Desk.gs` | Replay and commits, pass delivery and admission, tournament stages and desk operations |
| `web/` | Shared rendering, transport and styles, plus player, payment, scanner and staff views. The staff gate queue lives in `gate-queue.js`. |
| `tools/` | The build generates Pages assets and the Apps Script package. The build and server unit tests use the same explicit server source list. |
| `docs/`, `.deploy/`, `tests/` | Pages publication, local Apps Script packaging and regression suites. The browser fixture runs the packaged app against simulated Google services. |

## Change log

| Area | Change and operational effect |
| --- | --- |
| Receipt extraction | Paytm Ref No is recognized as a bank reference and outranks an app transaction ID. A missing or misread rupee symbol can be recovered when the adjacent numeric amount agrees with the written rupee amount. Conflicting values remain available for review. |
| Saved payment evidence | Administrators can reread missing amounts even when a reference was already captured. The operation fills missing screenshot fields, preserves supplied claims and original evidence, checks the proof revision, and records an audited update. Payment authorization continues through the receiving-bank reconciliation flow. |
| Server packaging | Split the 601-line server entry file by responsibility. The deployment still contains `Code.gs`, `Auth.gs` and `Floor.gs`. Existing Sheet menus, links and RPC callers keep their entry points. |
| Stage closure | A full qualifier with payment evidence exceeded the journal's 49,000-character guard. Oversized stage changes now write the attempt records and final stage record in one range under the lock. Replay preserves the payment history and presents one activity entry. Ordinary updates still append one row. |
| Student identity | Sign-in, session revalidation and pass email look up both the roll and mailbox. Each must identify the same single directory row. Ambiguous recipients go to desk delivery. Staff entry also checks new roll and email assignments for duplicates. Only one student's row is fetched for the identity lookup. [Google TextFinder reference](https://developers.google.com/apps-script/reference/spreadsheet/text-finder) |
| Payments and capacity | Manual review and PDF transcription read statement files before taking the event lock. Before saving, the server checks the current bank evidence and staff access. A changed statement requires reopening the decision. Wave selection counts occupied seats in one traversal, and the review queue indexes bank rows by key. |
| Gate and staff access | Offline retries keep their operation ID through service failures. Supporting browsers coordinate queue edits and sync across tabs using Web Locks. An acknowledgement that cannot be removed from storage is remembered in the open tab. A confirmed access denial clears private desk state and focuses the sign-in form. |
| Player experience | Concurrent asset loads share a request, and failed downloads can retry. A damaged floor cache falls back to the live read. Late account and ticket responses respect a change of signed-in student. A delayed IndexedDB open releases its connection after a blocked draft request. |
| Input and rendering | Malformed request and form JSON receive validation errors. The router records supported argument counts alongside each handler. Floor submissions validate table shape before use. Ticket and floor markup escape additional dynamic values, including cached seat and leaderboard fields. |

## Verification

| Local check | Before | After |
| --- | ---: | ---: |
| Server, payment, capacity and gate-race tests | 79 passed | 81 passed |
| Playwright journeys in Chrome | 54 passed | 59 passed |

The contract comparison matched all 208 original server function signatures, including all 60 callable server names. All 23 public POST operations retained their handler and accepted argument counts.

Two builds produced identical SHA-256 hashes for 17 Pages and Apps Script outputs. Both public HTML pages matched the original checkout after normalizing asset versions. All four source stylesheets and both published stylesheets matched as well.

The capacity suite took 50 simulated clients through payment and admission, checked 50 repeated scans, closed a 36-player wave and replayed it from an empty cache. Browser regressions cover staff revocation, conflicting tabs, offline acknowledgements, stale account responses and damaged floor storage alongside the existing checkout, keyboard and mobile journeys. The anonymous event script is 32,266 bytes against the existing 32 KiB budget.

The installed dependency tree passed `npm ls --all --offline`, and all 20 installed package versions matched the lockfile. A source scan found no matches for the checked private-key, Google credential, AWS access-key and GitHub token patterns in repository files. The automated approval review blocked the live npm advisory query because it would send dependency metadata to the public registry. Current advisory status remains unverified.

## Risk report

| Area | Remaining risk and follow-up |
| --- | --- |
| Deployment and providers | Local tests simulate Sheets, Drive, OCR and mail. Production permissions, inbox delivery, physical cameras and event-night latency need deployment or device verification. Use the existing read-only deployment smoke test after publishing. |
| Journal compatibility | Oversized closures use one row per changed attempt plus a closing row. Earlier server versions can replay those records, but their activity view can list the individual writes. The new snapshot cache starts cold. Keep the journal append-only so a cached prefix stays valid. |
| Gate devices | Browsers without Web Locks retain per-tab synchronization. Use one gate tab per volunteer on those devices. If device storage is unavailable, online confirmation is required. Revocation becomes visible when the desk next contacts the server. |
| Browser integration | Lazy bundles and Apps Script templates share classic-script globals. Preserve the cached-page rollout test when changing a shared binding or asset name. Field values interpolated into future HTML templates also need context-appropriate escaping. |
| Dependency advisories | Run the lockfile against an approved advisory service before release. The local dependency-tree check establishes installation consistency only. |

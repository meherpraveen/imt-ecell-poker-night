# Engineering audit

25 November 2026

## Architecture

GitHub Pages serves the event homepage, registration, live floor, pass and scanner. Google Apps Script serves the invitation-only staff interface and handles event operations. The private Sheets journal records payments, admission and tournament decisions. Drive holds the original evidence. Both interfaces still ship as plain browser JavaScript.

| Source | Responsibility |
| --- | --- |
| `gas/Code.gs` | App setup, HTTP dispatch, request validation, settings and the event lock |
| `gas/Auth.gs`, `StudentSignIn.gs`, `OwnerPassword.gs`, `Directory.gs`, `StaffAccess.gs` | Email challenges, temporary directory login, owner password verification, session lifecycle, student identity and staff permissions |
| `gas/Registration.gs`, `Pricing.gs`, `Receivers.gs` | Eligibility, wave capacity, receipts, prices and receiving accounts |
| `gas/ReceiptAmounts.gs`, `PaymentProof.gs`, `Statements.gs`, `Reconcile.gs` | Contextual amount reading, proof storage, OCR, bank imports and credit authorization |
| `gas/Journal.gs`, `Tickets.gs`, `Floor.gs`, `Desk.gs` | Replay and commits, pass delivery and admission, tournament stages and desk operations |
| `web/` | Shared rendering, transport and styles, plus player, payment, scanner and staff views. The staff gate queue lives in `gate-queue.js`. |
| `tools/` | The build generates Pages assets and the Apps Script package. The build and server unit tests use the same explicit server source list. |
| `docs/`, `.deploy/`, `tests/` | Pages publication, local Apps Script packaging and regression suites. The browser fixture runs the packaged app against simulated Google services. |

## Change log

| Area | Change and operational effect |
| --- | --- |
| Club password | Replace owner OTP with email plus password on the public page and password on the invitation-bound private desk. Use a private salted bcrypt verifier, a shared eight-attempt/15-minute guard, single-use public transfers and existing eight-hour staff sessions. Password rotation revokes password sessions and pending transfers. No password is persisted in browser storage or published to GitHub. Student and volunteer flows remain separate. |
| Sign-out transition | Clear the private view immediately and show progress until session revocation finishes. This prevents a fast password submission from being ignored while the preceding sign-out request still holds the UI action lock. A delayed-response browser regression reproduces the original timing bug and passes with the fix. |
| Temporary student login | Require both a nine-digit roll number and the matching unique college email. Pause student email-code sends while preserving owner verification, volunteer permissions and email mode for restoration. The server issues the existing student session without consulting the mail quota. Restoring email mode rejects sessions created through temporary login. |
| Login recovery and startup | A request UUID makes retries recover the same session. Account downloads can retry after login, and saved registrations and screenshots reopen on another device. Old student code screens yield to the new form. Retained email controls load only when needed; the anonymous runtime remains below 32 KiB. |
| Receipt extraction | Paytm Ref No is recognized as a bank reference and outranks an app transaction ID. A missing or misread rupee symbol can be recovered when the adjacent numeric amount agrees with the written rupee amount. Conflicting values remain available for review. |
| Receipt amounts | Extract whole numeric tokens and exclude promotional limits, cashback, fees and balances. Recover lost currency glyphs from payment labels, recognizable receipt summaries, matching written amounts or corroborating PhonePe amounts. Conflicting values and unsupported layouts remain unreadable; no amount is inferred from the entry price. The OCR cache namespace changed so prior cached mistakes are not reused. |
| Saved payment evidence | Administrators can reread both missing and incorrect amounts. Matching automatically derived claims follow the corrected OCR; payer-entered, explicitly corrected and owner-transcribed claim amounts remain intact. Ambiguous rereads clear automatic amounts for review. Original evidence and payment decisions are preserved, changed proofs are rejected, and repeated identical reads create no journal update. Payment authorization continues through the receiving-bank reconciliation flow. |
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

The receipt-amount follow-up passes all 91 automated tests and three payment browser journeys. Synthetic regression cases cover multiple receipt layouts and payment values, malformed amounts, promotional limits, balances, ambiguous OCR, preserved manual claims, concurrent edits and stale caches. A separate private check compares all 20 saved original images with extracted amounts; all match, including a genuine lower payment. Original images and student OCR are excluded from the repository. The targeted patch on the published backend also passes 12 focused tests and the same three browser journeys.

The temporary-login follow-up passes 97 server tests and all 68 browser journeys. Its exact patch on the published backend also passes six login tests, 12 receipt tests and 25 browser journeys covering sign-in, owner access, registration, screenshots, reconciliation, pass delivery and gate admission. The private directory dry run matches all 1,327 populated email records and preserves the intentionally blank record. Journal replay is identical for the 51 registrations and 36 screenshots present when the patch was prepared. All 212 existing deployed function signatures, the staff script, private resource configuration and floor code are preserved. The anonymous runtime is 32,464 bytes against the 32 KiB budget. No live test emails or registrations are created by these checks.

The owner-password follow-up passes 104 server tests and 72 browser journeys. The exact deployment patch passes 25 focused server checks and 30 browser journeys. Coverage includes unavailable mail, incorrect credentials, shared rate limits, duplicate responses, owner revocation, expiry, password rotation, single-use transfers and both login screens. All 216 pre-existing deployed server signatures remain intact. The anonymous runtime is 32,454 bytes; bcrypt is included only in the server package, and club login UI loads on demand. The installed dependency tree passes its offline consistency check with pinned bcryptjs 3.0.3.

The installed dependency tree passed `npm ls --all --offline`, and all 20 installed package versions matched the lockfile. A source scan found no matches for the checked private-key, Google credential, AWS access-key and GitHub token patterns in repository files. The automated approval review blocked the live npm advisory query because it would send dependency metadata to the public registry. Current advisory status remains unverified.

## Risk report

| Area | Remaining risk and follow-up |
| --- | --- |
| Club credential | Anyone holding the club email and password can act as administrator. Keep the credential within the authorized club team and rotate it after the event. The shared retry limit protects both entry points but can temporarily delay the owner after repeated failed attempts. |
| Temporary identity check | Roll number plus college email checks the directory, not mailbox ownership. Anyone who knows both can access that student's registration. Restore email verification after reliable delivery is available; the mode switch invalidates temporary sessions. Missing and duplicate directory details remain blocked for coordinator review. |
| Deployed staff runtime | This emergency release updates owner authentication while retaining the deployed payment, gate and refresh logic. The source fixes for revoked-session screen reset, failed offline acknowledgements and coordination between gate tabs need a separate staff deployment. The three corresponding browser cases run against the full source build, but are excluded from the targeted legacy-deployment suite. Server-side staff authorization remains enforced. |
| Deployment and providers | Local tests simulate Sheets, Drive, OCR and mail. Production permissions, inbox delivery, physical cameras and event-night latency need deployment or device verification. Use the existing read-only deployment smoke test after publishing. |
| Receipt recognition | OCR can still omit or misread evidence in new layouts or damaged images. Unsupported or conflicting amounts need review. Screenshots remain supporting evidence; a bank-credit match is required for authorization. Preserve that boundary when extending extraction rules. |
| Journal compatibility | Oversized closures use one row per changed attempt plus a closing row. Earlier server versions can replay those records, but their activity view can list the individual writes. The new snapshot cache starts cold. Keep the journal append-only so a cached prefix stays valid. |
| Gate devices | Browsers without Web Locks retain per-tab synchronization. Use one gate tab per volunteer on those devices. If device storage is unavailable, online confirmation is required. Revocation becomes visible when the desk next contacts the server. |
| Browser integration | Lazy bundles and Apps Script templates share classic-script globals. Preserve the cached-page rollout test when changing a shared binding or asset name. Field values interpolated into future HTML templates also need context-appropriate escaping. |
| Dependency advisories | Run the lockfile against an approved advisory service before release. The local dependency-tree check establishes installation consistency only. |

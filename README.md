# E-Cell Poker Night

The public event page runs on GitHub Pages from `docs/`. Registration, screenshot upload, payment review, pass delivery and floor management run in a club-owned Google Apps Script web app. Students use their nine-digit roll number. The public source contains no directory, payment screenshots or staff keys.

## Club desk

1. Import the private workbook into Google Sheets. The **Students** tab uses the columns **Roll Number**, **Name**, **Mail ID** and **Number**. Preserve roll numbers and phone numbers as text.
2. Run `npm install` and `npm run build`. Deploy the contents of `.deploy/` to the club’s Apps Script project. For an existing private Sheet and screenshot folder, add a deployment-only server file containing `const CLUB_RESOURCES = {book: 'SPREADSHEET_ID', folder: 'DRIVE_FOLDER_ID', owner: 'CLUB_EMAIL'};`. Omit that file to let setup create a new private Sheet and folder, then import the directory into its Students tab.
3. In the Apps Script editor select **setupEvent** and click **Run** as the club owner. Authorize Sheets, Drive and event email delivery. Deploy as a **Web app**, executing as the owner, accessible to **Anyone**. Put its published HTTPS `/exec` URL in `docs/assets/config.js`. GitHub Pages publishes only the `docs/` folder.
4. The private **Staff** tab contains the first admin key. Open **Staff desk**, sign in, then open **Settings**. Enter the coordinator’s UPI ID and recipient name and switch on registration. Create an individual volunteer key for the gate, desk or floor. Change its **Active** cell to **no** to revoke it.

## Payments and entry

The player gets a 15-minute seat hold, pays the displayed fee and uploads a screenshot. Their receipt page shows review status. The desk can search the visible UPI digits and see repeated image or suffix warnings. Compare the actual receiving-account credit and exact fee, enter its full 12-digit UPI bank reference, and choose **Approve and send code**. A verified reference can fund one attempt. A missing bank credit or partial match stays pending.

Email delivery uses the registered address. If delivery fails, the desk can open the same code and deliver it to the registered WhatsApp contact or show it after checking college ID. Resending preserves the code. Keep the private receipt page on the original device. Roll lookup alone never reveals an entry pass, phone number or email. The public live floor uses trainer aliases.

At the desk use **Walk-in or paid retry** to verify ₹199 or ₹149. A retry requires elimination and a seat in a later qualifier wave. Six waves share 216 playing attempts. New registrations close at 11 PM IST on 27 November 2026. A physical exit and wristband return are free and update the person’s headcount independently of the purchased attempt.

All active tables in a wave start together. The floor manager reviews the draw, records all chip stacks and resolves any tied lead before closing the stage. The highest stack at each table advances. The first two rounds last 30 minutes and the final lasts 60 minutes. Each starts with 10,000 chips per seated player.

## Event operations

Gate actions require a college ID or wristband check. A spent entry code cannot admit a second time. An offline gate action stays pending on that device until the server confirms it. Use the designated paper desk during a full outage and reconcile before admitting from another gate. The floor board refreshes every 15 seconds while visible.

Keep the Google files restricted to the club. Share individual staff keys through the club’s existing private channel. After reconciliation and the club’s dispute window, close registration, revoke staff keys and remove the screenshot files, contact data, payment journal and local offline queue according to club policy. The private Journal records event decisions and payment references. Use an unshared club-owned folder.

Run `npm test` for the event-state and payment checks. The suite uses synthetic student records.

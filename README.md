# E-Cell Poker Night

The event homepage, player registration and live floor run on GitHub Pages. To register, enter a nine-digit roll number or the email already on the student record. The club emails a six-digit sign-in code to that registered address. Returning players can sign in on another device to recover their registration. Anyone can view the live floor. The directory, payment screenshots and staff invitations stay in the club’s private Google files.

## Club desk

1. Import the private workbook into Google Sheets. The **Students** tab uses the columns **Roll Number**, **Name**, **Mail ID** and **Number**. Preserve roll numbers and phone numbers as text.
2. Run `npm install` and `npm run build`. Deploy the contents of `.deploy/` to the club’s Apps Script project. For an existing private Sheet and screenshot folder, add a deployment-only server file containing `const CLUB_RESOURCES = {book: 'SPREADSHEET_ID', folder: 'DRIVE_FOLDER_ID', owner: 'CLUB_EMAIL'};`. Omit that file to let setup create a new private Sheet and folder, then import the directory into its Students tab.
3. When the project is attached to the private Sheet, reload the Sheet as the club owner and choose **Poker Night → Set up club desk**. You can also select **setupEvent** and **Run** in the Apps Script editor. Authorize Sheets, Drive and event email delivery. Deploy as a **Web app**, executing as the owner, accessible to **Anyone**. Set the published HTTPS `/exec` URL in `web/config.js` and rebuild. GitHub Pages publishes the `docs/` folder.
4. In the private Sheet’s **Staff** tab, the owner opens their **Private desk link**, selects **Send code to club email** and enters the code from the club inbox. Only the configured club owner can use admin settings. In **Settings → Registration and payments**, enter the recipient name, add a UPI ID or upload a payment QR, then select **Publish payment details to players** and save. The club stores the QR in its private Drive folder.
5. Under **Settings → Volunteer access**, the owner can issue a desk, gate or floor invitation. Give each volunteer their own link and key privately. Set **Active** to **no** in their Staff row to revoke access.

## Email sign-in

Codes last 10 minutes and work once. A student can request another after one minute. Five incorrect entries lock that code, and the service sends at most five codes per account in 24 hours. A resend keeps the same active code and its remaining guess limit. The screen reports mail failures and send limits. If the message is missing, open **Email hasn’t arrived?** and enter the roll and registered address together to check the match and request delivery. Both roll and email sign-in require one unique address in the directory. E-Cell can resolve a missing or shared address after checking the student’s college ID.

The browser keeps the sign-in for the current tab. **Remember this device for 7 days** keeps it across visits. **Sign out** revokes that session. The private desk session lasts eight hours.

The club’s personal Gmail account has an Apps Script quota of 100 email recipients per 24-hour quota period, shared by login codes, resends and pass emails. The app reserves the last available email for the owner. Students who have signed in can also see their approved entry code in their receipt. If the limit is reached on event night, staff can use the existing college-ID and payment-verification flow at the venue. [Google Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)

## Payments and entry

Online pre-registration starts on 23 November at ₹149. Walk-ins cost ₹199 on 27 November. Before payment details are published, a student can save their registration and return to the same receipt to continue at their recorded fee. A 15-minute seat hold starts when payment is available and the student requests a seat. A full field goes to the waitlist. The player pays the displayed fee and uploads a screenshot. The desk can search the visible UPI digits and see repeated image or suffix warnings. Compare the receiving-account credit and exact fee, enter its full 12-digit UPI bank reference, and choose **Approve and send code**. A verified reference can fund one attempt.

Payment approval issues a separate single-use entry code. The player can find it on their signed-in receipt or in the pass email. The desk can also deliver it to the registered WhatsApp contact or show it after checking college ID. Resending a venue pass preserves the same entry code. The public live floor uses trainer aliases.

At the desk use **Walk-in or paid retry** to verify ₹199 or ₹149. A retry requires elimination and a seat in a later qualifier wave. Six waves share 216 playing attempts. New registrations close at 11 PM IST on 27 November 2026. A physical exit and wristband return are free and update the person’s headcount independently of the purchased attempt.

All active tables in a wave start together. The floor manager reviews the draw, records all chip stacks and resolves any tied lead before closing the stage. The highest stack at each table advances. The first two rounds last 30 minutes and the final lasts 60 minutes. Each starts with 10,000 chips per seated player.

## Event operations

Gate actions require a college ID or wristband check. A spent entry code cannot admit a second time. An offline gate action stays pending on that device until the server confirms it. Use the designated paper desk during a full outage and reconcile before admitting from another gate. The floor board refreshes every 15 seconds while visible.

Keep the Google files restricted to the club. Share individual staff keys through the club’s existing private channel. After reconciliation and the club’s dispute window, close registration, revoke staff keys and remove the screenshot files, contact data, payment journal and local offline queue according to club policy. The private Journal records event decisions and payment references. Use an unshared club-owned folder.

## Testing

Edit the event scripts and styles in `web/`. The homepage stylesheet and images live in `docs/assets/`. Run `npm run build` to regenerate the two public bundles and the Apps Script package.

Run `npm ci` and `npx playwright install chromium` once. Use `npm test` for the server regression suite and `npm run test:e2e` for browser journeys. The browser suite runs the real event code against isolated student records, simulated Google storage and a test mailbox. It covers email recovery, duplicate submissions, payment review, entry QR, offline gate sync, desk retries, waitlist offers, table scoring and the public floor. To use installed Chrome, set the environment variable `POKER_BROWSER_CHANNEL` to `chrome`.

After publishing Pages and Apps Script, run `npm run test:deploy`. This read-only smoke test checks the live routes, mobile layout, backend availability and public access boundaries. Live email delivery requires an explicitly requested send to the intended mailbox.

# E-Cell Poker Night

The event homepage, player registration and live floor run on GitHub Pages from `docs/`. These pages call the club’s Google Apps Script backend without Google sign-in. Students use their nine-digit roll number. The backend keeps the directory and uploaded screenshots in the club’s private Google files and serves the invitation-only staff desk.

## Club desk

1. Import the private workbook into Google Sheets. The **Students** tab uses the columns **Roll Number**, **Name**, **Mail ID** and **Number**. Preserve roll numbers and phone numbers as text.
2. Run `npm install` and `npm run build`. Deploy the contents of `.deploy/` to the club’s Apps Script project. For an existing private Sheet and screenshot folder, add a deployment-only server file containing `const CLUB_RESOURCES = {book: 'SPREADSHEET_ID', folder: 'DRIVE_FOLDER_ID', owner: 'CLUB_EMAIL'};`. Omit that file to let setup create a new private Sheet and folder, then import the directory into its Students tab.
3. When the project is attached to the private Sheet, reload the Sheet as the club owner and choose **Poker Night → Set up club desk**. You can also select **setupEvent** and **Run** in the Apps Script editor. Authorize Sheets, Drive and event email delivery. Deploy as a **Web app**, executing as the owner, accessible to **Anyone**. Put its published HTTPS `/exec` URL in `docs/assets/config.js`. GitHub Pages publishes only the `docs/` folder.
4. Reopen the private Sheet. On the **Staff** tab, open the **Private desk link** in your row and sign in with its **Private sign-in key**. In **Settings → Registration and payments**, the admin can pause signups, enter the UPI recipient name, and add a UPI ID, upload a payment QR, or use both. Preview the QR, select **Publish payment details to players**, and choose **Save payment settings** when ready. The club stores the QR in its private Drive folder and serves the image with a payable receipt.
5. Under **Settings → Volunteer access**, create an invitation for each volunteer and send them their own link and key privately. Volunteers can use the desk on their phones. Set **Active** to **no** in their Staff row to revoke their link and access.

## Payments and entry

Online pre-registration starts on 23 November at ₹149. Walk-ins cost ₹199 on 27 November. Before payment details are published, a student can save their registration and return to the same receipt to continue at their recorded fee. A 15-minute seat hold starts when payment is available and the student requests a seat. A full field goes to the waitlist. The player pays the displayed fee and uploads a screenshot. The desk can search the visible UPI digits and see repeated image or suffix warnings. Compare the receiving-account credit and exact fee, enter its full 12-digit UPI bank reference, and choose **Approve and send code**. A verified reference can fund one attempt.

Email delivery uses the registered address. If delivery fails, the desk can open the same code and deliver it to the registered WhatsApp contact or show it after checking college ID. Resending preserves the code. Keep the private receipt page on the original device. Roll lookup alone never reveals an entry pass, phone number or email. The public live floor uses trainer aliases.

At the desk use **Walk-in or paid retry** to verify ₹199 or ₹149. A retry requires elimination and a seat in a later qualifier wave. Six waves share 216 playing attempts. New registrations close at 11 PM IST on 27 November 2026. A physical exit and wristband return are free and update the person’s headcount independently of the purchased attempt.

All active tables in a wave start together. The floor manager reviews the draw, records all chip stacks and resolves any tied lead before closing the stage. The highest stack at each table advances. The first two rounds last 30 minutes and the final lasts 60 minutes. Each starts with 10,000 chips per seated player.

## Event operations

Gate actions require a college ID or wristband check. A spent entry code cannot admit a second time. An offline gate action stays pending on that device until the server confirms it. Use the designated paper desk during a full outage and reconcile before admitting from another gate. The floor board refreshes every 15 seconds while visible.

Keep the Google files restricted to the club. Share individual staff keys through the club’s existing private channel. After reconciliation and the club’s dispute window, close registration, revoke staff keys and remove the screenshot files, contact data, payment journal and local offline queue according to club policy. The private Journal records event decisions and payment references. Use an unshared club-owned folder.

Run `npm test` for the event-state and payment checks. The suite uses synthetic student records.

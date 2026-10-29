# Build60 Campus Growth Web App

A small Node.js web app for the NxtWave growth challenge simulation. It separates the public student experience from the manager dashboard.

## Start locally

Requires Node.js 18 or later. No external packages are required.

From this folder, run:

    node server.mjs

Then open:

- Student page: http://localhost:3401/
- First-time manager setup: http://localhost:3401/setup
- Manager dashboard: http://localhost:3401/manager

Create a manager username and a password with at least 12 characters on first setup. The password is stored as a salted scrypt hash. Do not share it.

## Live app

- Student app: https://nxtwavegrowthintern.onrender.com/
- Manager setup: https://nxtwavegrowthintern.onrender.com/setup
- Manager dashboard: https://nxtwavegrowthintern.onrender.com/manager

## Campaign flow

1. Sign in at /manager.
2. Create a source link for a campus representative, club, student group, or social channel.
3. Share the generated student link. It opens the student page with the source tagged automatically.
4. Students describe a non-sensitive problem, generate a project card, optionally share it, and complete the signup form.
5. The manager dashboard shows tagged visits, project cards, share-button clicks, signups, source attribution, and signup details.

The student page never displays manager controls. The manager route requires a signed-in session. Share clicks count clicks on the share button, not confirmed message deliveries.

## Data and privacy

The app stores campaign counts and registration details in the private data/campaign.json file on the server. Use fictional registrations while demonstrating the assignment. Do not collect real student details until you have deployed the app securely, provided an appropriate privacy notice, confirmed the workshop process, and decided how long records should be retained. The app does not send project problem text to the server.

The project card is created from guided templates; it does not call a live AI model. The proposed workshop agenda is an assumption for this assignment because no official agenda was supplied.

## Public deployment

The generated referral links use the current request address by default. For public links, set PUBLIC_BASE_URL to the final HTTPS origin before starting the app. Deploy behind HTTPS, use persistent private storage, configure backups and retention, and review access/security requirements before collecting real registration data. The included local demo is not a production deployment.


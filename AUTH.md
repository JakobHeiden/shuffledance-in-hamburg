# Auth

## Overview

User accounts for the shuffle site, with minimal UX:

- Registration only via an invite link shared in the WhatsApp group
- Login with passkeys only (no passwords, no email)
- Accounts persist across devices and cookie clearing
- Admin can recover lost accounts manually via SSH
- A private section ("Intern") for members, currently "Under construction"
- Meeting signups: members sign up under their account name; guests sign up with any name

All access control happens on the server. Showing/hiding things in the browser is UX only.

For where things live in the code, see [CLAUDE.md](CLAUDE.md#code-layout).

## Tech

- `@simplewebauthn/server`, `@simplewebauthn/browser` (passkey ceremonies)
- `better-sqlite3` (storage, `data/db.sqlite`)
- `cookie-parser`
- Sessions, invite check and recovery are custom code. No auth framework.

## Config

`settings.json` (gitignored) in production:

```json
{
   "isPause": false,
   "specialMessage": "",
   "registrationToken": "<random string>",
   "rpID": "shuffledance-in-hamburg.de",
   "origins": ["https://shuffledance-in-hamburg.de", "https://www.shuffledance-in-hamburg.de"]
}
```

`settings.template.json` has placeholders with local development values: `rpID: "localhost"`, origin `http://localhost:3000`.

- The auth keys are read once on startup; changes need `sudo systemctl restart shuffle`. The server refuses to start if any of them is missing.
- `isPause` and `specialMessage` are still re-read on every `GET /signup`, so they can be changed without a restart.
- The first entry of `origins` decides whether cookies get the `secure` flag (`https://` → yes), so local development over plain http works. It is also the base URL `scripts/recover.js` prints.

## Database

Created in `db.js` on startup. Foreign keys are enforced.

```sql
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,      -- random, also used as WebAuthn user handle
  name       TEXT NOT NULL,         -- display name, NOT unique
  created    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passkeys (
  id         TEXT PRIMARY KEY,      -- credential ID (base64url)
  user_id    TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  counter    INTEGER NOT NULL,
  transports TEXT,                  -- JSON array
  created    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS signups (
  date       TEXT NOT NULL,         -- meeting date, YYYYMMDD
  user_id    TEXT REFERENCES users(id),  -- set for members
  guest_id   TEXT,                  -- set for guests
  name       TEXT NOT NULL,         -- guests: as entered; members: copied from users.name
  status     TEXT NOT NULL CHECK (status IN ('ja','vielleicht','nein')),
  updated    INTEGER NOT NULL,
  CHECK ((user_id IS NULL) != (guest_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS signups_user  ON signups(date, user_id)  WHERE user_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS signups_guest ON signups(date, guest_id) WHERE guest_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recovery_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires    INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
```

## Sessions

- Cookie `session`: `httpOnly`, `secure` (see Config), `sameSite: 'strict'`.
- Sliding expiry, 6 months: each authenticated request extends `expires`.
- `requireAuth`: looks up the cookie in `sessions`, rejects with `401` if missing or expired, else sets `req.user` (`{ id, name }`).
- `optionalAuth`: same lookup, but lets guests through with `req.user = null`. Used by `POST /signup`.
- WebAuthn challenges are kept server-side between the "options" and "verify" calls, in memory, keyed by a short-lived `challenge` cookie, valid 5 minutes and single use. Lost on restart, which only means an in-progress registration/login has to be retried.

## Flows

### Registration (invite link)

Link: `https://shuffledance-in-hamburg.de/register.html?token=<registrationToken>`

1. `register.html` (static) reads `token` from the query string, keeps it in memory, strips it from the URL with `history.replaceState()`.
2. User enters a display name (prefilled from `localStorage.userName` if present) and taps "Registrieren".
3. `POST /api/register/options` with `{ token, name }` → server checks token (`403` if wrong), returns registration options with `residentKey: 'required'`, `userVerification: 'preferred'`.
4. Browser creates the passkey (`startRegistration`).
5. `POST /api/register/verify` with the response and the client's `guestId` (if any) → server verifies, creates user + passkey, creates session, sets cookie. Existing guest signups with that `guestId` are converted to the new user (set `user_id`, clear `guest_id`, replace `name`).
6. Redirect to main page.

Registration never happens on GET, because WhatsApp fetches shared links for previews.

### Login

1. "Anmelden" button → `POST /api/login/options` → options with empty `allowCredentials` (discoverable credentials, no username needed).
2. Browser signs (`startAuthentication`). Cross-device (QR code via phone) is handled by the browser.
3. `POST /api/login/verify` → server finds passkey by credential ID, verifies, updates `counter`, creates session.

### Logout

`POST /api/logout` → deletes the session row, clears the cookie.

### Recovery (admin, manual)

For members who lost all their passkeys. Nothing on the site links to `recover.html`; it is only reached via a link the admin sends.

1. User reports lost access; admin confirms identity out-of-band.
2. On the server: `node scripts/users.js` lists users (id, name, created, passkey count) to find the user ID.
3. `node scripts/recover.js <userId>` creates a recovery code (24h expiry, single use) and prints `https://shuffledance-in-hamburg.de/recover.html?code=<code>`.
4. Admin sends the link privately.
5. `recover.html` strips the code from the URL and POSTs it to `/api/recover` → server checks code (unused, unexpired), marks it used, creates session for that user.
6. Page prompts to add a new passkey: `POST /api/passkey/options` + `/api/passkey/verify` (both `requireAuth`) → new passkey attached to the existing user.

## Meeting signups

Stored in the `signups` table. Earlier signups were stored as text files (`data/YYYYMMDD.txt`). On startup, `db.js` imports any such files that are still there: each name becomes a guest row with a generated `guest_id` (last line per name wins), and the file is renamed to `*.txt.imported` so it is not imported again.

Each signup is identified by `user_id` (members) or `guest_id` (guests), never by name. Duplicate names are allowed everywhere: two members, two guests, or a member and a guest can share a name.

### Members (valid session)

- Name input is hidden; the page shows "Angemeldet als <account name>".
- Server ignores any submitted name and uses `req.user.name`.
- Upsert on `(date, user_id)`: changing status updates the existing row.

### Guests (no session)

- Name input, prefilled from `localStorage.userName`.
- Client keeps a `localStorage.guestId`, created once with `crypto.randomUUID()`, and sends it with every signup.
- Upsert on `(date, guest_id)`: the same browser changing its status updates its row instead of adding one. A different guest with the same name gets their own row.
- If a guest changes the name field, the existing row for their `guestId` is updated with the new name.
- Known limitation: clearing localStorage or switching browsers produces a new `guestId`, so a guest can appear twice. Accepted; admin can delete rows via `sqlite3`.

### API

**POST `/signup`**
- Body (form-encoded): `status`, plus `name` and `guestId` for guests.
- Session present → member path. Else → `name` and `guestId` required, else `400`.

**GET `/signup`**
- Fields: `paused`, `message` (when paused), `date`, `specialMessage`, `signups`.
- `signups` is an array ordered by `updated`: `[{ "name": "Anna", "status": "ja" }, ...]`

## Endpoints summary

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/register/options` | invite token | start registration |
| `POST /api/register/verify` | challenge | finish registration |
| `POST /api/login/options` | – | start login |
| `POST /api/login/verify` | challenge | finish login |
| `POST /api/logout` | session | end session |
| `POST /api/recover` | recovery code | log in via recovery |
| `POST /api/passkey/options` | session | start adding passkey |
| `POST /api/passkey/verify` | session | finish adding passkey |
| `GET /api/me` | session | `{ id, name }` or `401` |
| `GET /api/private` | session | private section content, `{ content }` |
| `POST /signup` | session or guest ID | meeting signup |
| `GET /signup` | – | next meeting + signups |

## Frontend (index.html)

- On load, `fetch('/api/me')`. If `200`: show user name, logout button, and the "Intern" nav button. If `401`: show the "Anmelden" button only.
- Private section content comes from `/api/private`. It must not be in `index.html`, since static files are public.

## Rendering user content

User-submitted content (names, comments) must never be inserted via `innerHTML` with template literals. Use `document.createElement` + `textContent` (as the attendee list does), or at least `escapeHtml`.

## Not implemented

- Members changing their account name
- Admin UI (SSH scripts are enough)
- Revoking users: delete their `sessions` and `passkeys` rows via `sqlite3`; rotate `registrationToken` if needed

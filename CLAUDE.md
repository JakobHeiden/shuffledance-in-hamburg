# Shuffledance in Hamburg

Small Express site for organizing the weekly shuffle meetups: next-meeting signups, comments, links, and member accounts with passkeys.

## Running

- `npm install`, then `node server.js` → http://localhost:3000
- `settings.json` (gitignored) is created from `settings.template.json` if missing. Auth keys need valid values, see [AUTH.md](AUTH.md#config).
- Data lives in `data/` (gitignored): `data/db.sqlite`.

## Deployment

Push to `master` → GitHub Actions (`.github/workflows/deploy.yml`) SSHes into the server, resets `/srv/shuffle` to `origin/master`, runs `npm ci` and `sudo systemctl restart shuffle`.

## Code layout

| File | Contents |
|---|---|
| `server.js` | Express app: static files, `/signup`, `/comments`, mounts the auth router, serves the browser WebAuthn lib at `/vendor/simplewebauthn-browser.js` |
| `db.js` | SQLite connection, schema, one-time import of old text-file signups |
| `auth.js` | Sessions, WebAuthn challenges, all `/api/*` routes, `requireAuth` / `optionalAuth` |
| `public/index.html`, `script.js`, `style.css` | Main page: sections, signups, comments, login/logout, private section |
| `public/pause.html` | Content shown instead of the meeting section when `isPause` is set |
| `public/register.html`, `register.js` | Invite-link registration page |
| `public/recover.html`, `recover.js` | Account recovery page |
| `scripts/users.js`, `scripts/recover.js` | Admin scripts, run on the server (described in `scripts/README-scripts.txt`) |

## Docs

- [AUTH.md](AUTH.md): accounts, passkeys, sessions, recovery, signups data model and API

## Conventions

- UI text is German.
- JS uses 3-space indentation.
- Never render user-submitted content via `innerHTML` with template literals; use `createElement` + `textContent`.
- All access control happens on the server. Everything in `public/` is publicly readable.

const crypto = require('crypto');
const express = require('express');
const {
   generateRegistrationOptions,
   verifyRegistrationResponse,
   generateAuthenticationOptions,
   verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { db } = require('./db');

const SIX_MONTHS = 183 * 24 * 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const RP_NAME = 'Shuffledance in Hamburg';

function randomToken(bytes = 32) {
   return crypto.randomBytes(bytes).toString('base64url');
}

function validateName(name) {
   if (typeof name !== 'string') return null;
   name = name.trim();
   if (!name || name.length > 50) return null;
   return name;
}

module.exports = function createAuth(settings) {
   const { registrationToken, rpID, origins } = settings;
   if (!registrationToken || !rpID || !Array.isArray(origins) || origins.length === 0) {
      throw new Error('settings.json is missing registrationToken, rpID or origins');
   }
   const secure = origins[0].startsWith('https://');
   const cookieOptions = { httpOnly: true, secure, sameSite: 'strict', path: '/' };

   // --- Sessions ---

   function createSession(res, userId) {
      const token = randomToken();
      db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)')
         .run(token, userId, Date.now() + SIX_MONTHS);
      res.cookie('session', token, { ...cookieOptions, maxAge: SIX_MONTHS });
   }

   // Returns the logged-in user (and slides the session expiry), or null.
   function getUser(req, res) {
      const token = req.cookies.session;
      if (!token) return null;
      const row = db.prepare(`
         SELECT users.id, users.name, sessions.expires FROM sessions
         JOIN users ON users.id = sessions.user_id
         WHERE sessions.token = ?`).get(token);
      if (!row) return null;
      if (row.expires < Date.now()) {
         db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
         return null;
      }
      db.prepare('UPDATE sessions SET expires = ? WHERE token = ?').run(Date.now() + SIX_MONTHS, token);
      res.cookie('session', token, { ...cookieOptions, maxAge: SIX_MONTHS });
      return { id: row.id, name: row.name };
   }

   function requireAuth(req, res, next) {
      const user = getUser(req, res);
      if (!user) return res.status(401).send('Nicht angemeldet');
      req.user = user;
      next();
   }

   // Sets req.user if a valid session exists, but lets guests through.
   function optionalAuth(req, res, next) {
      req.user = getUser(req, res);
      next();
   }

   // --- WebAuthn challenges (in memory, keyed by a short-lived cookie) ---

   const challenges = new Map();

   function storeChallenge(res, data) {
      const now = Date.now();
      for (const [key, entry] of challenges) {
         if (entry.expires < now) challenges.delete(key);
      }
      const key = randomToken();
      challenges.set(key, { ...data, expires: now + FIVE_MINUTES });
      res.cookie('challenge', key, { ...cookieOptions, maxAge: FIVE_MINUTES });
   }

   // Single use: the challenge is removed whether verification succeeds or not.
   function takeChallenge(req, res, type) {
      const key = req.cookies.challenge;
      res.clearCookie('challenge', cookieOptions);
      if (!key) return null;
      const entry = challenges.get(key);
      challenges.delete(key);
      if (!entry || entry.type !== type || entry.expires < Date.now()) return null;
      return entry;
   }

   // --- Passkey helpers ---

   async function registrationOptions(userId, userName, excludeCredentials = []) {
      return generateRegistrationOptions({
         rpName: RP_NAME,
         rpID,
         userName,
         userDisplayName: userName,
         userID: new TextEncoder().encode(userId),
         attestationType: 'none',
         excludeCredentials,
         authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      });
   }

   async function verifyRegistration(response, expectedChallenge) {
      const { verified, registrationInfo } = await verifyRegistrationResponse({
         response,
         expectedChallenge,
         expectedOrigin: origins,
         expectedRPID: rpID,
         requireUserVerification: false,
      });
      if (!verified) throw new Error('Registration not verified');
      return registrationInfo.credential;
   }

   function savePasskey(userId, credential) {
      db.prepare(`INSERT INTO passkeys (id, user_id, public_key, counter, transports, created) VALUES (?, ?, ?, ?, ?, ?)`)
         .run(credential.id, userId, Buffer.from(credential.publicKey), credential.counter,
            JSON.stringify(credential.transports || []), Date.now());
   }

   // --- Routes ---

   const router = express.Router();
   router.use(express.json({ limit: '100kb' }));

   router.post('/register/options', async (req, res) => {
      const { token, name } = req.body || {};
      if (typeof token !== 'string' || !crypto.timingSafeEqual(
         crypto.createHash('sha256').update(token).digest(),
         crypto.createHash('sha256').update(registrationToken).digest())) {
         return res.status(403).send('Ungültiger Einladungslink');
      }
      const validName = validateName(name);
      if (!validName) return res.status(400).send('Ungültiger Name');

      const userId = randomToken(16);
      const options = await registrationOptions(userId, validName);
      storeChallenge(res, { type: 'register', challenge: options.challenge, userId, name: validName });
      res.json(options);
   });

   router.post('/register/verify', async (req, res) => {
      const entry = takeChallenge(req, res, 'register');
      if (!entry) return res.status(400).send('Sitzung abgelaufen, bitte erneut versuchen');
      const { response, guestId } = req.body || {};

      let credential;
      try {
         credential = await verifyRegistration(response, entry.challenge);
      } catch (err) {
         console.log('Registration verification failed:', err.message);
         return res.status(400).send('Passkey konnte nicht verifiziert werden');
      }

      try {
         db.transaction(() => {
            db.prepare('INSERT INTO users (id, name, created) VALUES (?, ?, ?)').run(entry.userId, entry.name, Date.now());
            savePasskey(entry.userId, credential);
            if (typeof guestId === 'string' && guestId) {
               db.prepare('UPDATE signups SET user_id = ?, guest_id = NULL, name = ? WHERE guest_id = ?')
                  .run(entry.userId, entry.name, guestId);
            }
         })();
      } catch (err) {
         console.error('Registration failed:', err);
         return res.status(500).send('Fehler bei der Registrierung');
      }
      createSession(res, entry.userId);
      console.log(`[user registered] id=${entry.userId} name=${entry.name}`);
      res.json({ id: entry.userId, name: entry.name });
   });

   router.post('/login/options', async (req, res) => {
      const options = await generateAuthenticationOptions({
         rpID,
         allowCredentials: [],
         userVerification: 'preferred',
      });
      storeChallenge(res, { type: 'login', challenge: options.challenge });
      res.json(options);
   });

   router.post('/login/verify', async (req, res) => {
      const entry = takeChallenge(req, res, 'login');
      if (!entry) return res.status(400).send('Sitzung abgelaufen, bitte erneut versuchen');
      const response = (req.body || {}).response;
      if (!response || typeof response.id !== 'string') return res.status(400).send('Ungültige Anfrage');

      const passkey = db.prepare('SELECT * FROM passkeys WHERE id = ?').get(response.id);
      if (!passkey) return res.status(400).send('Unbekannter Passkey');

      let verification;
      try {
         verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: entry.challenge,
            expectedOrigin: origins,
            expectedRPID: rpID,
            credential: {
               id: passkey.id,
               publicKey: new Uint8Array(passkey.public_key),
               counter: passkey.counter,
               transports: JSON.parse(passkey.transports || '[]'),
            },
            requireUserVerification: false,
         });
      } catch (err) {
         console.log('Login verification failed:', err.message);
         return res.status(400).send('Passkey konnte nicht verifiziert werden');
      }
      if (!verification.verified) return res.status(400).send('Passkey konnte nicht verifiziert werden');

      db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(verification.authenticationInfo.newCounter, passkey.id);
      createSession(res, passkey.user_id);
      const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(passkey.user_id);
      res.json(user);
   });

   router.post('/logout', (req, res) => {
      if (req.cookies.session) {
         db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.session);
      }
      res.clearCookie('session', cookieOptions);
      res.sendStatus(200);
   });

   router.post('/recover', (req, res) => {
      const { code } = req.body || {};
      if (typeof code !== 'string') return res.status(400).send('Ungültiger Code');
      const row = db.prepare('SELECT user_id FROM recovery_codes WHERE code = ? AND used = 0 AND expires > ?').get(code, Date.now());
      if (!row) return res.status(403).send('Code ungültig oder abgelaufen');
      const result = db.prepare('UPDATE recovery_codes SET used = 1 WHERE code = ? AND used = 0').run(code);
      if (result.changes !== 1) return res.status(403).send('Code ungültig oder abgelaufen');
      createSession(res, row.user_id);
      console.log(`[account recovered] id=${row.user_id}`);
      res.json(db.prepare('SELECT id, name FROM users WHERE id = ?').get(row.user_id));
   });

   router.post('/passkey/options', requireAuth, async (req, res) => {
      const existing = db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(req.user.id)
         .map(p => ({ id: p.id, transports: JSON.parse(p.transports || '[]') }));
      const options = await registrationOptions(req.user.id, req.user.name, existing);
      storeChallenge(res, { type: 'passkey', challenge: options.challenge, userId: req.user.id });
      res.json(options);
   });

   router.post('/passkey/verify', requireAuth, async (req, res) => {
      const entry = takeChallenge(req, res, 'passkey');
      if (!entry || entry.userId !== req.user.id) return res.status(400).send('Sitzung abgelaufen, bitte erneut versuchen');

      let credential;
      try {
         credential = await verifyRegistration((req.body || {}).response, entry.challenge);
      } catch (err) {
         console.log('Passkey verification failed:', err.message);
         return res.status(400).send('Passkey konnte nicht verifiziert werden');
      }
      try {
         savePasskey(req.user.id, credential);
      } catch (err) {
         console.error('Saving passkey failed:', err);
         return res.status(500).send('Passkey konnte nicht gespeichert werden');
      }
      console.log(`[passkey added] user=${req.user.id}`);
      res.sendStatus(200);
   });

   router.get('/me', requireAuth, (req, res) => {
      res.json(req.user);
   });

   router.get('/private', requireAuth, (req, res) => {
      res.json({ content: 'Under construction' });
   });

   return { router, requireAuth, optionalAuth, validateName };
};

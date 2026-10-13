const express = require('express');
const app = express();
const PORT = 3000;
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { db, importTextSignups } = require('./db');
const createAuth = require('./auth');

importTextSignups();

// Auth settings are read once on startup; changes need a restart.
const { optionalAuth, validateName, router: authRouter } = createAuth(readSettingsSync());

app.use(express.static('public'));
app.get('/vendor/simplewebauthn-browser.js', (req, res) => {
   res.sendFile(path.join(__dirname, 'node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js'));
});
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(morgan('dev'));
app.use('/api', authRouter);

const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const COMMENT_RATE_LIMIT = 10;
const ipTimestamps = new Map();

app.listen(PORT, () => {
   console.log(`Server listening on port ${PORT}`);
});

app.post('/signup', optionalAuth, (req, res) => {
   const { status, guestId } = req.body;
   if (!['ja', 'vielleicht', 'nein'].includes(status)) {
      return res.status(400).send('Invalid status');
   }

   const date = getNextSundayInternalString();
   const now = Date.now();
   try {
      if (req.user) {
         db.prepare(`
            INSERT INTO signups (date, user_id, name, status, updated) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (date, user_id) WHERE user_id IS NOT NULL
            DO UPDATE SET name = excluded.name, status = excluded.status, updated = excluded.updated`)
            .run(date, req.user.id, req.user.name, status, now);
      } else {
         const name = validateName(req.body.name);
         if (!name || typeof guestId !== 'string' || !guestId || guestId.length > 100) {
            return res.status(400).send('Missing fields');
         }
         db.prepare(`
            INSERT INTO signups (date, guest_id, name, status, updated) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (date, guest_id) WHERE guest_id IS NOT NULL
            DO UPDATE SET name = excluded.name, status = excluded.status, updated = excluded.updated`)
            .run(date, guestId, name, status, now);
      }
      res.sendStatus(200);
   } catch (err) {
      console.error('POST /signup error:', err);
      res.status(500).send('ERROR');
   }
});

app.get('/signup', async (req, res) => {
   try {
      const settings = await readSettings();
      if (settings.isPause) {
         const pauseContent = await fs.readFile('public/pause.html', 'utf8');
         res.json({ paused: true, message: pauseContent });
      } else {
         res.json({
            paused: false,
            date: getNextSundayInternalString(),
            signups: readSignups(),
            specialMessage: settings.specialMessage
         });
      }
   } catch (err) {
      console.error('GET /signup error:', err);
      res.status(500).send('ERROR');
   }
});

async function readSettings() {
   let content;
   try {
      content = await fs.readFile('settings.json', 'utf8');
   } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      console.log('settings.json not found, creating it from settings.template.json');
      await fs.copyFile('settings.template.json', 'settings.json');
      content = await fs.readFile('settings.json', 'utf8');
   }
   return JSON.parse(content);
}

function readSettingsSync() {
   if (!fsSync.existsSync('settings.json')) {
      console.log('settings.json not found, creating it from settings.template.json');
      fsSync.copyFileSync('settings.template.json', 'settings.json');
   }
   return JSON.parse(fsSync.readFileSync('settings.json', 'utf8'));
}

function readSignups() {
   return db.prepare('SELECT name, status FROM signups WHERE date = ? ORDER BY updated')
      .all(getNextSundayInternalString());
}

function getNextSundayDate() {
   const now = new Date();
   const dayOfWeek = now.getDay();
   let daysUntilSunday;
   if (dayOfWeek === 0 && now.getHours() < 15) {
      daysUntilSunday = 0;
   } else {
      daysUntilSunday = 7 - dayOfWeek;
   }
   const nextSunday = new Date(now);
   nextSunday.setDate(now.getDate() + daysUntilSunday);
   return nextSunday;
}

function getNextSundayDisplayString() {
   return getNextSundayDate().toLocaleDateString('de-DE');
}

function getNextSundayInternalString() {
   return getNextSundayDate().toISOString().split('T')[0].replace(/-/g, '');
}

app.get('/comments', (req, res) => {
   const cutoff = Date.now() - ONE_YEAR;
   db.prepare('DELETE FROM comments WHERE timestamp < ?').run(cutoff);
   const comments = db.prepare('SELECT id, name, text, timestamp FROM comments ORDER BY timestamp DESC').all();
   res.json(comments);
});

app.post('/comments', (req, res) => {
   const { name, text } = req.body;
   if (!name || !text) return res.status(400).send('Missing fields');
   if (name.length > 50) return res.status(400).send('Name too long');
   if (text.length > 500) return res.status(400).send('Text too long');

   const ip = req.ip;
   const now = Date.now();
   const recentCommentTimestamps = (ipTimestamps.get(ip) || []).filter(t => now - t < TEN_MINUTES);
   if (recentCommentTimestamps.length >= COMMENT_RATE_LIMIT) return res.status(429).send('Zu viele Nachrichten auf einmal. Bitte warte etwas.');
   recentCommentTimestamps.push(now);
   ipTimestamps.set(ip, recentCommentTimestamps);

   db.prepare('INSERT INTO comments (name, text, timestamp) VALUES (?, ?, ?)').run(name, text, now);
   console.log(`[comment posted] ip=${ip} name=${name}`);
   res.sendStatus(200);
});

app.delete('/comments/:id', (req, res) => {
   const { name } = req.body;
   const { id } = req.params;
   if (!name) return res.status(400).send('Missing name');

   const comment = db.prepare('SELECT name FROM comments WHERE id = ?').get(id);
   if (!comment) return res.status(404).send('Not found');
   if (comment.name !== name) return res.status(403).send('Forbidden');

   db.prepare('DELETE FROM comments WHERE id = ?').run(id);
   console.log(`[comment deleted] ip=${req.ip} name=${name} id=${id}`);
   res.sendStatus(200);
});


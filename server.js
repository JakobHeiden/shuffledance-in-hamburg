const express = require('express');
const app = express();
const PORT = 3000;
const fs = require('fs').promises;
const morgan = require('morgan');
const Database = require('better-sqlite3');
const crypto = require('crypto');

app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(morgan('dev'));

fs.mkdir('data', { recursive: true }).catch(err => {
   console.error('Failed to create data directory:', err);
});

const db = new Database('data/db.sqlite');
db.exec(`
   CREATE TABLE IF NOT EXISTS comments (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL,
      text      TEXT    NOT NULL,
      timestamp INTEGER NOT NULL
   )
`);
db.exec(`
   CREATE TABLE IF NOT EXISTS members (
      token      TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
   )
`);
db.exec(`
   CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
   )
`);
const existingRegToken = db.prepare("SELECT value FROM config WHERE key='registration_token'").get();
if (!existingRegToken) {
   const token = crypto.randomBytes(24).toString('hex');
   db.prepare("INSERT INTO config (key, value) VALUES ('registration_token', ?)").run(token);
   console.log(`[bootstrap] registration_token=${token}`);
}

const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const COMMENT_RATE_LIMIT = 10;
const ipTimestamps = new Map();

app.listen(PORT, () => {
   console.log(`Server listening on port ${PORT}`);
});

app.post('/signup', async (req, res) => {
   const { name, status } = req.body;

   const error = validatePostBody(name, status);
   if (error) {
      console.log(`invalid post body: ${error}`);
      return res.status(400).send(error);
   }

   try {
      await writeSignup(name, status);
      res.sendStatus(200);
   } catch (err) {
      console.error('POST /signup error:', err);
      res.status(500).send('ERROR');
   }
});

app.get('/signup', async (req, res) => {
   let response;
   try {// signups paused
      const pauseContent = await fs.readFile('public/pause.html', 'utf8');
      response = res.json({ paused: true, message: pauseContent });
   } catch (err) {// signups not paused
      res.json({
      paused: false,
      date: getNextSundayInternalString(),
      signups: await readSignups()
   });
   }

});

function validatePostBody(name, status) {
   if (!name || !status) {
      return 'Missing fields';
   }
   if (!['ja', 'vielleicht', 'nein'].includes(status)) {
      return 'Invalid status';
   }

   return null;
}

async function readSignups() {
   const date = getNextSundayInternalString();
   const filename = `data/${date}.txt`;
   let fileContent;
   const signups = {};
   try {
      fileContent = await fs.readFile(filename, 'utf8');
   } catch (err) {
      return signups;
   }

   fileContent.trim().split('\n')
      .map(line => line.split(','))
      .forEach(([name, status]) => signups[name] = status);
   return signups;
}

async function writeSignup(name, status) {
   const date = getNextSundayInternalString();
   const filename = `data/${date}.txt`;
   try {
      await fs.appendFile(filename, `${name},${status}\n`);
   } catch (err) {
      console.error('Failed to write signup:', err);
      throw new Error('Could not save signup');
   }
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

app.post('/register', (req, res) => {
   const { registrationToken, name } = req.body;

   const regRow = db.prepare("SELECT value FROM config WHERE key='registration_token'").get();
   if (!registrationToken || registrationToken !== regRow.value) {
      return res.status(401).send('Ungültiger Zugangscode');
   }
   if (!name || typeof name !== 'string' || name.length > 50) {
      return res.status(400).send('Name fehlt oder zu lang');
   }

   const token = crypto.randomBytes(24).toString('hex');
   try {
      db.prepare('INSERT INTO members (token, name, created_at) VALUES (?, ?, ?)')
         .run(token, name, Date.now());
   } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
         return res.status(409).send('Name schon vergeben, nimm einen anderen');
      }
      throw err;
   }
   console.log(`[member registered] name=${name}`);
   res.json({ token });
});

function requireMember(req, res, next) {
   const header = req.get('authorization') || '';
   const match = header.match(/^Bearer (.+)$/);
   if (!match) return res.status(401).send('Nicht angemeldet');
   const member = db.prepare('SELECT name FROM members WHERE token = ?').get(match[1]);
   if (!member) return res.status(401).send('Nicht angemeldet');
   req.member = member;
   next();
}

app.get('/api/me', requireMember, (req, res) => {
   res.json({ name: req.member.name });
});


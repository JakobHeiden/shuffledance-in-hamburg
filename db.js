const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'db.sqlite'));
db.pragma('foreign_keys = ON');
db.exec(`
   CREATE TABLE IF NOT EXISTS comments (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL,
      text      TEXT    NOT NULL,
      timestamp INTEGER NOT NULL
   );

   CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created    INTEGER NOT NULL
   );

   CREATE TABLE IF NOT EXISTS passkeys (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      public_key BLOB NOT NULL,
      counter    INTEGER NOT NULL,
      transports TEXT,
      created    INTEGER NOT NULL
   );

   CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      expires    INTEGER NOT NULL
   );

   CREATE TABLE IF NOT EXISTS signups (
      date       TEXT NOT NULL,
      user_id    TEXT REFERENCES users(id),
      guest_id   TEXT,
      name       TEXT NOT NULL,
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
`);

// One-time import of the old text-file signups (data/YYYYMMDD.txt).
// Each imported file is renamed to *.txt.imported so it is never imported twice.
function importTextSignups() {
   const files = fs.readdirSync(DATA_DIR).filter(f => /^\d{8}\.txt$/.test(f));
   const insert = db.prepare(`INSERT INTO signups (date, guest_id, name, status, updated) VALUES (?, ?, ?, ?, ?)`);
   for (const file of files) {
      const filePath = path.join(DATA_DIR, file);
      const date = file.slice(0, 8);
      const mtime = fs.statSync(filePath).mtimeMs;
      const latest = new Map();
      fs.readFileSync(filePath, 'utf8').trim().split('\n').forEach(line => {
         const [name, status] = line.split(',');
         if (!name || !['ja', 'vielleicht', 'nein'].includes(status)) return;
         latest.delete(name); // re-insert so Map order reflects the last line
         latest.set(name, status);
      });
      const total = latest.size;
      db.transaction(() => {
         let i = 0;
         for (const [name, status] of latest) {
            insert.run(date, crypto.randomUUID(), name, status, Math.floor(mtime) - (total - i++));
         }
      })();
      fs.renameSync(filePath, filePath + '.imported');
      console.log(`Imported ${total} signups from ${file}`);
   }
}

module.exports = { db, importTextSignups };

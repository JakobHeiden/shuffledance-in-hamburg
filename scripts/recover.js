// Creates a one-time recovery link for a user: node scripts/recover.js <userId>
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const userId = process.argv[2];
if (!userId) {
   console.error('Usage: node scripts/recover.js <userId>   (find IDs with node scripts/users.js)');
   process.exit(1);
}

const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
if (!user) {
   console.error(`No user with id ${userId}`);
   process.exit(1);
}

const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'settings.json'), 'utf8'));
const code = crypto.randomBytes(32).toString('base64url');
db.prepare('INSERT INTO recovery_codes (code, user_id, expires) VALUES (?, ?, ?)')
   .run(code, user.id, Date.now() + TWENTY_FOUR_HOURS);

console.log(`Recovery link for ${user.name} (valid 24h, single use):`);
console.log(`${settings.origins[0]}/recover.html?code=${code}`);

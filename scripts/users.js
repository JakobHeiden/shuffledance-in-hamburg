// Lists all users: node scripts/users.js
const { db } = require('../db');

const users = db.prepare(`
   SELECT users.id, users.name, users.created, COUNT(passkeys.id) AS passkeys
   FROM users LEFT JOIN passkeys ON passkeys.user_id = users.id
   GROUP BY users.id ORDER BY users.created`).all();

if (users.length === 0) {
   console.log('No users.');
} else {
   console.table(users.map(u => ({
      id: u.id,
      name: u.name,
      created: new Date(u.created).toLocaleString('de-DE'),
      passkeys: u.passkeys,
   })));
}

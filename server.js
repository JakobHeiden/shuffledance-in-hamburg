const express = require('express');
const app = express();
const PORT = 3000;
const fs = require('fs').promises;
const morgan = require('morgan');

app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

fs.mkdir('data', { recursive: true }).catch(err => {
   console.error('Failed to create data directory:', err);
});

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




const token = new URLSearchParams(location.search).get('token');
history.replaceState(null, '', location.pathname);

function showMessage(text, type) {
   const messageDiv = document.getElementById('message');
   messageDiv.textContent = text;
   messageDiv.className = 'message ' + type;
}

if (!token) {
   showMessage('Dieser Link ist ungültig. Bitte nutze den Einladungslink aus der WhatsApp-Gruppe.', 'error');
   document.getElementById('register-btn').disabled = true;
}

const savedName = localStorage.getItem('userName');
if (savedName) {
   document.getElementById('name').value = savedName;
}

document.getElementById('register-btn').addEventListener('click', async function() {
   const name = document.getElementById('name').value.trim();
   if (!name) {
      showMessage('Bitte gib deinen Namen ein.', 'error');
      return;
   }

   this.disabled = true;
   try {
      const optionsResponse = await fetch('/api/register/options', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ token, name })
      });
      if (!optionsResponse.ok) throw new Error(await optionsResponse.text());
      const optionsJSON = await optionsResponse.json();

      const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON });

      const verifyResponse = await fetch('/api/register/verify', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ response, guestId: localStorage.getItem('guestId') })
      });
      if (!verifyResponse.ok) throw new Error(await verifyResponse.text());

      localStorage.setItem('userName', name);
      location.href = '/';
   } catch (error) {
      console.log('Register error:', error);
      if (error.name === 'NotAllowedError') {
         showMessage('Abgebrochen. Versuch es nochmal.', 'error');
      } else {
         showMessage('Registrierung fehlgeschlagen. ' + error.message, 'error');
      }
      this.disabled = false;
   }
});

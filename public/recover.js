const code = new URLSearchParams(location.search).get('code');
history.replaceState(null, '', location.pathname);

const statusText = document.getElementById('status');
const passkeyBtn = document.getElementById('passkey-btn');

function showMessage(text, type) {
   const messageDiv = document.getElementById('message');
   messageDiv.textContent = text;
   messageDiv.className = 'message ' + type;
}

async function recover() {
   if (!code) {
      statusText.textContent = 'Dieser Link ist ungültig.';
      return;
   }
   try {
      const response = await fetch('/api/recover', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ code })
      });
      if (!response.ok) throw new Error(await response.text());
      const user = await response.json();
      localStorage.setItem('userName', user.name);
      statusText.textContent = `Hallo ${user.name}, du bist wieder angemeldet. Leg jetzt einen neuen Passkey an, damit du dich auch später wieder anmelden kannst.`;
      passkeyBtn.hidden = false;
   } catch (error) {
      console.log('Recover error:', error);
      statusText.textContent = 'Wiederherstellung fehlgeschlagen. ' + error.message;
   }
}

passkeyBtn.addEventListener('click', async function() {
   this.disabled = true;
   try {
      const optionsResponse = await fetch('/api/passkey/options', { method: 'POST' });
      if (!optionsResponse.ok) throw new Error(await optionsResponse.text());
      const optionsJSON = await optionsResponse.json();

      const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON });

      const verifyResponse = await fetch('/api/passkey/verify', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ response })
      });
      if (!verifyResponse.ok) throw new Error(await verifyResponse.text());

      location.href = '/';
   } catch (error) {
      console.log('Add passkey error:', error);
      if (error.name === 'NotAllowedError') {
         showMessage('Abgebrochen. Versuch es nochmal.', 'error');
      } else {
         showMessage('Passkey konnte nicht angelegt werden. ' + error.message, 'error');
      }
      this.disabled = false;
   }
});

recover();

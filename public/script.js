function showSection(sectionName) {
   const sections = document.querySelectorAll('.content-section');
   sections.forEach(section => section.classList.remove('active'));
   document.getElementById(sectionName).classList.add('active');

   document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
   document.getElementById(sectionName + '-btn').classList.add('active');

   if (sectionName === 'meet') {
      loadData();
   }
   if (sectionName === 'commentSection') {
      loadComments();
   }
   if (sectionName === 'private') {
      loadPrivate();
   }
}

let currentUser = null;

function getGuestId() {
   let guestId = localStorage.getItem('guestId');
   if (!guestId) {
      guestId = crypto.randomUUID();
      localStorage.setItem('guestId', guestId);
   }
   return guestId;
}

async function loadMe() {
   try {
      const response = await fetch('/api/me', { signal: AbortSignal.timeout(5000) });
      currentUser = response.ok ? await response.json() : null;
   } catch (error) {
      console.log('Load user error:', error);
      currentUser = null;
   }
   if (currentUser) {
      localStorage.setItem('userName', currentUser.name);
   }
   renderAuthState();
}

function renderAuthState() {
   const loggedIn = currentUser !== null;
   document.getElementById('auth-user').hidden = !loggedIn;
   document.getElementById('auth-user').textContent = loggedIn ? 'Angemeldet als ' + currentUser.name : '';
   document.getElementById('logout-btn').hidden = !loggedIn;
   document.getElementById('login-btn').hidden = loggedIn;
   document.getElementById('private-btn').hidden = !loggedIn;
   document.getElementById('member-name').hidden = !loggedIn;
   document.getElementById('member-name').textContent = loggedIn ? 'Angemeldet als ' + currentUser.name : '';
   document.getElementById('guest-name-group').hidden = loggedIn;
}

function showAuthMessage(text, type) {
   const el = document.getElementById('auth-message');
   el.textContent = text;
   el.className = 'message ' + type;
}

document.getElementById('login-btn').addEventListener('click', async function() {
   showAuthMessage('', '');
   try {
      const optionsResponse = await fetch('/api/login/options', { method: 'POST' });
      if (!optionsResponse.ok) throw new Error(await optionsResponse.text());
      const optionsJSON = await optionsResponse.json();
      const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
      const verifyResponse = await fetch('/api/login/verify', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ response })
      });
      if (!verifyResponse.ok) throw new Error(await verifyResponse.text());
      location.reload();
   } catch (error) {
      console.log('Login error:', error);
      if (error.name === 'NotAllowedError') return; // user cancelled
      showAuthMessage('Anmeldung fehlgeschlagen. ' + error.message, 'error');
   }
});

document.getElementById('logout-btn').addEventListener('click', async function() {
   await fetch('/api/logout', { method: 'POST' });
   location.reload();
});

async function loadPrivate() {
   const container = document.getElementById('private-content');
   try {
      const response = await fetch('/api/private', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(response.status);
      const data = await response.json();
      const p = document.createElement('p');
      p.textContent = data.content;
      container.replaceChildren(p);
   } catch (error) {
      console.log('Load private error:', error);
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = 'Fehler beim Laden';
      container.replaceChildren(p);
   }
}

document.querySelectorAll('.signup-btn').forEach(btn => {
   btn.addEventListener('click', async function() {
      const name = document.getElementById('name').value.trim();
      const status = this.dataset.status;

      if (!currentUser && name === '') {
         showMessage('Bitte gib deinen Namen ein.', 'error');
         return;
      }

      let body = 'status=' + status;
      if (!currentUser) {
         body += '&name=' + encodeURIComponent(name) + '&guestId=' + encodeURIComponent(getGuestId());
      }

      try {
         console.log("fetching signups...");
         const response = await fetch('/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
         });

         if (response.ok) {
            if (!currentUser) localStorage.setItem('userName', name);
            showMessage('Anmeldung erfolgreich!', 'success');
            document.getElementById('name').value = '';
            await loadData();
         } else {
            showMessage('Fehler bei der Anmeldung.', 'error');
         }
      } catch (error) {
         console.log('Signup error:', error);
         showMessage('Verbindungsfehler.', 'error');
      }
   });
});

function showMessage(text, type) {
   const messageDiv = document.getElementById('message');
   messageDiv.textContent = text;
   messageDiv.className = 'message ' + type;
}

async function loadData() {
   const savedName = localStorage.getItem('userName');
   if (savedName) {
      document.getElementById('name').value = savedName;
   }

   try {
      const response = await fetch('/signup', { signal: AbortSignal.timeout(5000) });
      console.log('Received rseponse:', response);
      const data = await response.json();
      console.log('Received data:', data);
      if (data.paused) {
         document.getElementById('meet').innerHTML = data.message;
      } else {
         document.getElementById('date').innerHTML = formatDateForDisplay(data.date);
         document.getElementById('specialMessage').textContent = data.specialMessage;

         const attendeeList = document.getElementById('attendeeList');
         if (data.signups.length === 0) {
            attendeeList.innerHTML = '<p class="no-attendees">Noch keine Anmeldungen</p>';
         } else {
            attendeeList.replaceChildren(...data.signups.map(({ name, status }) => {
               const span = document.createElement('span');
               span.className = 'attendee-name status-' + status;
               span.textContent = name;
               return span;
            }));
         }
      }
   } catch (error) {
      console.log('Load data error:', error);
      document.getElementById('attendeeList').innerHTML =
         '<p class="error">Fehler beim Laden der Liste</p>';
   }
}

function formatDateForDisplay(date) {
   const year = date.substring(0, 4);
   const month = date.substring(4, 6);
   const day = date.substring(6, 8);
   return `${day}.${month}.${year}`;
}

async function loadComments() {
   const savedName = localStorage.getItem('userName');
   if (savedName) {
      document.getElementById('comment-name').value = savedName;
   }

   try {
      const response = await fetch('/comments', { signal: AbortSignal.timeout(5000) });
      const comments = await response.json();
      const list = document.getElementById('comments');
      if (comments.length === 0) {
         list.innerHTML = '<p class="no-attendees">Noch keine Kommentare</p>';
      } else {
         list.innerHTML = comments.map(comment => {
            const isOwn = comment.name === localStorage.getItem('userName');
            const date = new Date(comment.timestamp).toLocaleDateString('de-DE');
            const deleteBtn = isOwn
               ? `<button class="delete-comment-btn" data-id="${comment.id}">Löschen</button>`
               : '';
            return `<div class="comment">
               <div class="comment-header"><span class="comment-author">${escapeHtml(comment.name)}</span><span class="comment-date">${date}</span>${deleteBtn}</div>
               <div class="comment-text">${escapeHtml(comment.text)}</div>
            </div>`;
         }).join('');
         list.querySelectorAll('.delete-comment-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteComment(btn.dataset.id));
         });
      }
   } catch (error) {
      console.log('Load comments error:', error);
      document.getElementById('comments').innerHTML = '<p class="error">Fehler beim Laden der Kommentare</p>';
   }
}

document.getElementById('comment-submit').addEventListener('click', async function() {
   const name = document.getElementById('comment-name').value.trim();
   const text = document.getElementById('comment-text').value.trim();

   if (!name) { showCommentMessage('Bitte gib deinen Namen ein.', 'error'); return; }
   if (!text) { showCommentMessage('Bitte schreib etwas.', 'error'); return; }

   try {
      const response = await fetch('/comments', {
         method: 'POST',
         headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
         body: 'name=' + encodeURIComponent(name) + '&text=' + encodeURIComponent(text)
      });
      if (response.ok) {
         localStorage.setItem('userName', name);
         document.getElementById('comment-text').value = '';
         await loadComments();
      } else {
         showCommentMessage(await response.text(), 'error');
      }
   } catch (error) {
      console.log('Post comment error:', error);
      showCommentMessage('Verbindungsfehler.', 'error');
   }
});

async function deleteComment(id) {
   const name = localStorage.getItem('userName');
   if (!name) return;
   try {
      const response = await fetch('/comments/' + id, {
         method: 'DELETE',
         headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
         body: 'name=' + encodeURIComponent(name)
      });
      if (response.ok) {
         await loadComments();
      } else {
         showCommentMessage('Fehler beim Löschen.', 'error');
      }
   } catch (error) {
      console.log('Delete comment error:', error);
      showCommentMessage('Verbindungsfehler.', 'error');
   }
}

function showCommentMessage(text, type) {
   const el = document.getElementById('comment-message');
   el.textContent = text;
   el.className = 'message ' + type;
}

function escapeHtml(str) {
   return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

async function hasRecentCommentByOthers(ownName) {
   try {
      const response = await fetch('/comments', { signal: AbortSignal.timeout(5000) });
      const comments = await response.json();
      return comments.some(comment => comment.name !== ownName && Date.now() - comment.timestamp < SEVEN_DAYS);
   } catch (error) {
      console.log('Recent comment check error:', error);
      return false;
   }
}

document.addEventListener('DOMContentLoaded', async function() {
   await loadMe();
   const savedName = localStorage.getItem('userName');
   if (savedName) {
      showSection(await hasRecentCommentByOthers(savedName) ? 'commentSection' : 'meet');
   } else {
      showSection('welcome');
   }
});

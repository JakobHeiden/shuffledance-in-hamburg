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
}

document.querySelectorAll('.signup-btn').forEach(btn => {
   btn.addEventListener('click', async function() {
      const name = document.getElementById('name').value.trim();
      const status = this.dataset.status;

      if (name === '') {
         showMessage('Bitte gib deinen Namen ein.', 'error');
         return;
      }

      try {
         console.log("fetching signups...");
         const response = await fetch('/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'name=' + encodeURIComponent(name)
            + '&status=' + status
         });

         if (response.ok) {
            localStorage.setItem('userName', name);
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

         const attendeeList = document.getElementById('attendeeList');
         const signupEntries = Object.entries(data.signups);
         if (signupEntries.length === 0) {
            attendeeList.innerHTML = '<p class="no-attendees">Noch keine Anmeldungen</p>';
         } else {
            attendeeList.innerHTML = signupEntries
               .map(([name, status]) => `<span class="attendee-name status-${status}">${name}</span>`)
               .join('');
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
      const list = document.getElementById('commentSection');
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
      document.getElementById('commentSection').innerHTML = '<p class="error">Fehler beim Laden der Kommentare</p>';
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

document.addEventListener('DOMContentLoaded', function() {
   const savedName = localStorage.getItem('userName');
   if (savedName) {
      showSection('meet');
   } else {
      showSection('welcome');
   }
});

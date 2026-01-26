(function(){
  const API_BASE = (window && window.__API_BASE__) || 'https://mkc-backend-kqov.onrender.com/auth';
  const submit = document.getElementById('submit');
  const msg = document.getElementById('msg');
  const newPass = document.getElementById('new-pass');
  const confirmPass = document.getElementById('confirm-pass');

  function show(text, type){ msg.textContent = text; msg.style.color = type === 'error' ? 'crimson' : 'green'; }

  // Ensure token exists (from _magic_consume.html storing it) or in query
  const qs = new URLSearchParams(location.search.replace(/^\?/, ''));
  const tokenFromQuery = qs.get('token');
  const token = tokenFromQuery || localStorage.getItem('access_token') || localStorage.getItem('token') || null;

  if (!token) {
    show('Session introuvable. Cliquez de nouveau le lien dans votre email.', 'error');
    submit.disabled = true;
  }

  submit.addEventListener('click', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const p1 = newPass.value || '';
    const p2 = confirmPass.value || '';
    if (p1.length < 8) { show('Le mot de passe doit contenir au moins 8 caractères.', 'error'); return; }
    if (p1 !== p2) { show('Les mots de passe ne correspondent pas.', 'error'); return; }

    submit.disabled = true;
    show('Réinitialisation en cours...', '');

    try {
      const resp = await fetch(`${API_BASE}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ password: p1 })
      });

      const text = await resp.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch(e){ data = { _text: text } }

      if (!resp.ok) {
        show(data?.message || data?.error || data?._text || 'Erreur serveur', 'error');
        submit.disabled = false;
        return;
      }

      show('Mot de passe mis à jour. Redirection vers la connexion...', 'success');
      // Clear tokens and redirect
      localStorage.removeItem('token'); localStorage.removeItem('access_token');
      setTimeout(() => { window.location.href = 'index.html'; }, 1400);

    } catch (err) {
      show('Erreur réseau. Réessayez.', 'error');
      submit.disabled = false;
    }
  });
})();
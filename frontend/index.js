// index.js — Maritime Kargo Consulting
// Auth logic : login / register + forgot-password modal
// Selectors aligned with the redesigned index.html
(() => {
  /* ═══════ ELEMENTS ═══════ */
  const form       = document.getElementById('authForm');
  const emailInput = document.getElementById('email');
  const passInput  = document.getElementById('password');
  const toggleBtn  = document.querySelector('.toggle-pass');
  const submitBtn  = document.getElementById('submitBtn');
  const switchBtn  = document.getElementById('switchBtn');
  const msgEl      = document.getElementById('message');
  const loginCard  = document.querySelector('.login-card');
  const eyeOpen    = document.getElementById('eye-open');
  const eyeClosed  = document.getElementById('eye-closed');

  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const configuredApiBase = document.querySelector('meta[name="api-base"]')?.content?.trim();
  const API_BASE = `${(window.__API_BASE__ || configuredApiBase || (isLocalHost ? 'http://localhost:3000' : 'https://mkc-ijms.onrender.com')).replace(/\/+$/, '')}/auth`;
  let mode = 'login'; // 'login' | 'register'

  /* ═══════ PASSWORD TOGGLE ═══════ */
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const isPass = passInput.getAttribute('type') === 'password';
      passInput.setAttribute('type', isPass ? 'text' : 'password');
      toggleBtn.setAttribute('aria-label', isPass ? 'Cacher le mot de passe' : 'Afficher le mot de passe');
      if (eyeOpen)   eyeOpen.style.display   = isPass ? 'none' : '';
      if (eyeClosed) eyeClosed.style.display = isPass ? '' : 'none';
    });
  }

  /* ═══════ MODE SWITCH (login ↔ register) ═══════ */
  if (switchBtn) {
    switchBtn.addEventListener('click', () => {
      if (mode === 'login') {
        mode = 'register';

        // Update button text
        const btnSpan = submitBtn.querySelector('span');
        if (btnSpan) btnSpan.textContent = window.i18n ? window.i18n.t('sign_up') : "S'inscrire";
        switchBtn.textContent = window.i18n ? window.i18n.t('already_registered') : 'Déjà inscrit ? Se connecter';

        // Update subtitle
        const subtitle = document.querySelector('.card-subtitle');
        if (subtitle) subtitle.textContent = window.i18n ? window.i18n.t('register_subtitle') : 'Créez un compte en quelques secondes';

        // Inject name field if not present
        if (!document.getElementById('nameField')) {
          const group = document.createElement('div');
          group.className = 'form-field';
          group.id = 'nameField';
          group.innerHTML = `
            <label for="fullname" class="field-label">Nom complet</label>
            <div class="input-wrap">
              <span class="input-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </span>
              <input id="fullname" name="fullname" type="text" autocomplete="name" class="form-input" placeholder="Prénom Nom" required />
            </div>`;
          // Insert before email field
          const emailField = document.getElementById('nameField-wrap') || form.querySelector('.form-field');
          form.insertBefore(group, emailField);
        }

      } else {
        mode = 'login';

        const btnSpan = submitBtn.querySelector('span');
        if (btnSpan) btnSpan.textContent = window.i18n ? window.i18n.t('index_title') : 'Se connecter';
        switchBtn.textContent = window.i18n ? window.i18n.t('create_account') : 'Créer un compte';

        const subtitle = document.querySelector('.card-subtitle');
        if (subtitle) subtitle.textContent = window.i18n ? window.i18n.t('index_subtitle') : 'Accédez à votre espace FERI et AD';

        const nf = document.getElementById('nameField');
        if (nf) nf.remove();
      }

      clearMessage();
    });
  }

  /* ═══════ HELPERS ═══════ */
  function setMessage(text, type = 'muted') {
    if (!msgEl) return;
    const colors = { muted: '#6B7280', danger: '#EF4444', success: '#10B981' };
    msgEl.style.color = colors[type] || colors.muted;
    msgEl.textContent = text;
  }

  function clearMessage() {
    if (msgEl) { msgEl.style.color = ''; msgEl.textContent = ''; }
  }

  function getRoleFromToken(token) {
    if (typeof token !== 'string') return '';
    try {
      const payload = token.split('.')[1];
      if (!payload) return '';
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = decodeURIComponent(atob(normalized).split('').map(char =>
        `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`
      ).join(''));
      return String(JSON.parse(decoded)?.role || '').toUpperCase();
    } catch {
      return '';
    }
  }

  function getRoleFromAuthResponse(response) {
    const session = response?.session || response?.data?.session;
    const user = response?.user || response?.data?.user || session?.user;
    const explicitRole = response?.role
      || response?.profile?.role
      || response?.data?.role
      || response?.data?.profile?.role;
    if (explicitRole) return String(explicitRole).toUpperCase();

    const token = session?.access_token
      || session?.accessToken
      || response?.access_token
      || response?.accessToken
      || response?.token
      || response?.jwt
      || response?.data?.access_token
      || response?.data?.token;
    const tokenRole = getRoleFromToken(token);
    if (tokenRole) return tokenRole;

    const role = user?.role
      || user?.user_metadata?.role
      || user?.app_metadata?.role
      || session?.user?.role
      || session?.user?.user_metadata?.role
      || session?.user?.app_metadata?.role;
    return String(role || '').toUpperCase();
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.style.opacity = loading ? '0.75' : '1';
    const span = submitBtn.querySelector('span');
    if (span) {
      if (loading) {
        span.textContent = mode === 'login'
          ? (window.i18n ? window.i18n.t('signing_in') : 'Connexion…')
          : (window.i18n ? window.i18n.t('registering') : 'Inscription…');
      } else {
        span.textContent = mode === 'login'
          ? (window.i18n ? window.i18n.t('index_title') : 'Se connecter')
          : (window.i18n ? window.i18n.t('sign_up') : "S'inscrire");
      }
    }
  }

  /* ═══════ FORM SUBMIT ═══════ */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessage();

    // Validate
    const emailVal = emailInput.value.trim();
    const passVal  = passInput.value;

    if (!emailVal || !passVal) {
      setMessage(window.i18n ? window.i18n.t('validation_fill_required') : 'Veuillez remplir tous les champs requis.', 'danger');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      setMessage(window.i18n ? window.i18n.t('validation_invalid_email') : 'Adresse email invalide.', 'danger');
      return;
    }
    if (passVal.length < 8) {
      setMessage(window.i18n ? window.i18n.t('validation_password_length') : 'Le mot de passe doit contenir au moins 8 caractères.', 'danger');
      return;
    }

    setLoading(true);
    setMessage('Vérification…', 'muted');

    try {
      const payload = { email: emailVal, password: passVal };

      if (mode === 'register') {
        const full = (document.getElementById('fullname')?.value || '').trim();
        if (!full || full.length < 2) throw new Error('Veuillez renseigner votre nom et prénom.');
        const parts  = full.split(/\s+/);
        const prenom = parts.shift();
        payload.prenom = prenom;
        payload.nom    = parts.join(' ') || prenom;
      }

      const endpoint = mode === 'login' ? `${API_BASE}/login` : `${API_BASE}/register`;
      const resp     = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      let data = {};
      const raw = await resp.text();
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = { _text: raw }; }

      if (!resp.ok) {
        const errMsg = data?.message || data?.error || data?._text || "Erreur d'authentification.";
        throw new Error(errMsg);
      }

      await new Promise(r => setTimeout(r, 400));

      // Auto-login after register to get token
      let loginData = {};
      let userRole = getRoleFromAuthResponse(data);
      if (mode === 'register') {
        try {
          const loginResp = await fetch(`${API_BASE}/login`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email: emailVal, password: passVal }),
          });
          const loginRaw = await loginResp.text();
          try { loginData = loginRaw ? JSON.parse(loginRaw) : {}; } catch { loginData = { _text: loginRaw }; }
          if (!loginResp.ok) throw new Error(loginData?.message || 'Auto-login failed');
          userRole = getRoleFromAuthResponse(loginData) || userRole;
          const session = loginData.session || loginData?.data?.session;
          const token   = session?.access_token || session?.accessToken || loginData.token || loginData.access_token;
          if (token) {
            localStorage.setItem('token', token);
            localStorage.setItem('access_token', token);
          }
        } catch (autoErr) {
          console.error('Auto-login after register failed', autoErr);
        }
      } else {
        const token = data.session?.access_token || data.token || data.access_token || data.jwt || data.accessToken;
        if (token) {
          localStorage.setItem('token', token);
          localStorage.setItem('access_token', token);
        }
      }

      if (!userRole) {
        throw new Error('Connexion réussie, mais le rôle du compte n’a pas été reçu. Vérifiez le rôle ADMIN dans Supabase puis reconnectez-vous.');
      }

      setMessage(
        mode === 'login'
          ? (window.i18n ? window.i18n.t('sign_in_success') : 'Connexion réussie. Redirection…')
          : (window.i18n ? window.i18n.t('register_success') : 'Inscription réussie. Redirection…'),
        'success'
      );

      setTimeout(() => {
        const destination = userRole === 'CLIENT'
          ? 'dashboard_client.html'
          : userRole === 'ADMIN'
            ? 'dashboard_admin.html'
            : 'facture_carte.html';
        console.info('Redirection après connexion', { role: userRole, destination });
        window.location.href = destination;
      }, 700);

    } catch (err) {
      setMessage(err?.message || (window.i18n ? window.i18n.t('validation_fill_required') : 'Erreur serveur. Réessayez plus tard.'), 'danger');
      setLoading(false);
    }
  });

  /* ═══════ SUBTLE CARD TILT on hover ═══════ */
  if (loginCard) {
    const col = document.querySelector('.card-col');
    if (col) {
      col.addEventListener('mousemove', (e) => {
        const rect = loginCard.getBoundingClientRect();
        const dx = (e.clientX - rect.left - rect.width  / 2) / (rect.width  / 2);
        const dy = (e.clientY - rect.top  - rect.height / 2) / (rect.height / 2);
        loginCard.style.transform = `perspective(1000px) rotateY(${dx * 2}deg) rotateX(${dy * -1.5}deg)`;
      });
      col.addEventListener('mouseleave', () => {
        loginCard.style.transform = '';
      });
    }
  }

  /* ═══════ FORGOT PASSWORD MODAL ═══════ */
  const forgotModal    = document.getElementById('forgot-modal');
  const forgotClose    = document.getElementById('forgot-close');
  const forgotCancel   = document.getElementById('forgot-cancel');
  const forgotForm     = document.getElementById('forgot-form');
  const forgotEmail    = document.getElementById('forgot-email');
  const forgotFeedback = document.getElementById('forgot-feedback');

  function openForgot() {
    if (!forgotModal) return;
    forgotModal.setAttribute('aria-hidden', 'false');
    forgotModal.style.display = 'flex';
    if (forgotEmail) forgotEmail.focus();
    if (forgotFeedback) { forgotFeedback.style.display = 'none'; forgotFeedback.textContent = ''; }
  }

  function closeForgot() {
    if (!forgotModal) return;
    forgotModal.setAttribute('aria-hidden', 'true');
    forgotModal.style.display = 'none';
  }

  // Clicking the forgot link navigates to forgot.html (default behaviour).
  // Modal stays available for programmatic use.
  if (forgotClose)  forgotClose.addEventListener('click', closeForgot);
  if (forgotCancel) forgotCancel.addEventListener('click', closeForgot);

  // Close modal on backdrop click
  if (forgotModal) {
    forgotModal.addEventListener('click', (e) => {
      if (e.target === forgotModal) closeForgot();
    });
  }

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeForgot();
  });

  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!forgotFeedback) return;
      forgotFeedback.style.display = 'none';

      const val = forgotEmail?.value?.trim();
      if (!val || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        forgotFeedback.style.display = 'block';
        forgotFeedback.style.color   = '#EF4444';
        forgotFeedback.textContent   = window.i18n ? window.i18n.t('validation_invalid_email') : 'Adresse email invalide.';
        return;
      }

      try {
        await fetch(`${API_BASE}/forgot`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email: val }),
        }).catch(() => null);
      } catch { /* ignore */ }

      forgotFeedback.style.display = 'block';
      forgotFeedback.style.color   = '#10B981';
      forgotFeedback.textContent   = window.i18n
        ? window.i18n.t('forgot_modal_success')
        : 'Si un compte existe, vous recevrez les instructions par email.';

      if (forgotEmail) forgotEmail.disabled = true;
      const sub = document.getElementById('forgot-submit');
      if (sub) sub.disabled = true;
      setTimeout(closeForgot, 2500);
    });
  }

})();
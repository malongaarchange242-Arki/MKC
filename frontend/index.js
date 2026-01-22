// index.js
(() => {
    const form = document.getElementById('authForm');
    const email = document.getElementById('email');
    const password = document.getElementById('password');
    const toggle = document.querySelector('.toggle-pass');
    const switchBtn = document.getElementById('switchBtn');
    const submitBtn = document.getElementById('submitBtn');
    const message = document.getElementById('message');
    const floatingLogo = document.querySelector('.floating-logo');
    const card = document.querySelector('.card');
    const effectLayer = document.querySelector('.cursor-effect');

    let mode = 'login'; // ou 'register'

    // Toggle mot de passe
    toggle.addEventListener('click', () => {
        const t = password.getAttribute('type') === 'password' ? 'text' : 'password';
        password.setAttribute('type', t);
        toggle.textContent = t === 'text' ? '🙈' : '👁️';
    });

    // Switch login/register
    switchBtn.addEventListener('click', () => {
        if (mode === 'login') {
            mode = 'register';
            submitBtn.textContent = "S'inscrire";
            switchBtn.textContent = "Déjà inscrit ? Se connecter";
            document.querySelector('.subtitle').textContent = "Créez un compte en quelques secondes";
            if (!document.getElementById('nameField')) {
                const group = document.createElement('div');
                group.className = 'input-group';
                group.id = 'nameField';
                group.innerHTML = `<label for="fullname">Nom complet</label>
          <input id="fullname" name="fullname" type="text" autocomplete="name" required />`;
                form.insertBefore(group, form.firstElementChild.nextSibling);
            }
        } else {
            mode = 'login';
            submitBtn.textContent = "Se connecter";
            switchBtn.textContent = "Créer un compte";
            document.querySelector('.subtitle').textContent = "Accédez à vos demandes FERI et AD";
            const nf = document.getElementById('nameField');
            if (nf) nf.remove();
        }
        message.textContent = '';
    });

    // Soumission — envoi vers le backend (login / register)
    // Backend API base (Node backend handles auth)
    const API_BASE = 'https://mkc-backend-kqov.onrender.com/auth';

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        message.style.color = 'var(--muted)';
        message.textContent = 'Vérification...';

        if (!email.value || !password.value) {
            message.style.color = 'var(--danger)';
            message.textContent = 'Veuillez remplir tous les champs requis.';
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
            message.style.color = 'var(--danger)';
            message.textContent = 'Adresse email invalide.';
            return;
        }
        if (password.value.length < 8) {
            message.style.color = 'var(--danger)';
            message.textContent = 'Le mot de passe doit contenir au moins 8 caractères.';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.style.opacity = 0.8;
        submitBtn.textContent = mode === 'login' ? 'Connexion…' : "Inscription…";

        floatingLogo.style.transition = 'transform 0.6s cubic-bezier(.2,.9,.3,1)';
        floatingLogo.style.transform = 'translateZ(40px) rotateY(-18deg) scale(1.03)';

        try {
            const payload = { email: email.value.trim(), password: password.value };
            if (mode === 'register') {
                const full = (document.getElementById('fullname')?.value || '').trim();
                if (!full || full.length < 2) {
                    throw new Error('Veuillez renseigner votre nom et prénom.');
                }
                // simple split: premier mot -> prenom, reste -> nom
                const parts = full.split(/\s+/);
                const prenom = parts.shift();
                const nom = parts.join(' ') || '';
                payload.prenom = prenom;
                payload.nom = nom || prenom;
            }

            const endpoint = mode === 'login' ? `${API_BASE}/login` : `${API_BASE}/register`;
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // Essayer de parser JSON, sinon lire texte brut pour obtenir un message d'erreur utile
            let data = {};
            const text = await resp.text();
            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {
                data = { _text: text };
            }

            if (!resp.ok) {
                console.error('Auth error response:', data);
                const err = data?.message || data?.error || data?._text || 'Erreur d’authentification.';
                throw new Error(err);
            }

            // Attendre un court instant pour l'animation
            await new Promise(r => setTimeout(r, 400));

            // Si on vient de s'inscrire, faire automatiquement un login pour récupérer le token
            if (mode === 'register') {
                try {
                    const loginResp = await fetch(`${API_BASE}/login`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: email.value.trim(), password: password.value })
                    });
                    const loginText = await loginResp.text();
                    let loginData = {};
                    try { loginData = loginText ? JSON.parse(loginText) : {}; } catch (e) { loginData = { _text: loginText }; }
                    if (!loginResp.ok) {
                        console.error('Login after register failed:', loginData);
                        throw new Error(loginData?.message || loginData?.error || loginData?._text || 'Login failed');
                    }
                    const session = loginData.session || loginData?.data?.session;
                    const token = session?.access_token || session?.accessToken || loginData.token || loginData.access_token;
                    if (token) {
                        localStorage.setItem('token', token);
                        localStorage.setItem('access_token', token);
                    }
                } catch (e) {
                    console.error('Auto-login failed', e);
                }
            } else {
                // login direct: stocker token si présent
                const token = data.session?.access_token || data.token || data.access_token || data.jwt || data.accessToken;
                if (token) {
                    localStorage.setItem('token', token);
                    localStorage.setItem('access_token', token);
                }
            }

            message.style.color = 'var(--success)';
            message.textContent = mode === 'login' ? 'Connexion réussie. Redirection…' : "Inscription réussie. Redirection…";

            // Déterminer le rôle utilisateur et rediriger en conséquence
            const extractRole = (obj) => {
                try {
                    return obj?.user?.user_metadata?.role || obj?.user_metadata?.role || obj?.role || null;
                } catch (e) { return null; }
            };

            const roleCandidates = [];
            // cas login
            roleCandidates.push(extractRole(data));
            // si insription -> loginData peut exister
            if (typeof loginData !== 'undefined') roleCandidates.push(extractRole(loginData));
            // essayer aussi user object top-level
            roleCandidates.push(data?.user?.user_metadata?.role);

            const role = roleCandidates.find(r => typeof r === 'string' && r.length) || 'CLIENT';

            setTimeout(() => {
                if (role.toUpperCase() === 'ADMIN') {
                    window.location.href = 'dashboard_admin.html';
                } else {
                    window.location.href = 'dashboard_client.html';
                }
            }, 700);

        } catch (err) {
            message.style.color = 'var(--danger)';
            message.textContent = err?.message || 'Erreur serveur. Réessayez plus tard.';
            submitBtn.disabled = false;
            submitBtn.style.opacity = 1;
            submitBtn.textContent = mode === 'login' ? 'Se connecter' : "S'inscrire";
            floatingLogo.style.transform = '';
        }
    });

    // Effet parallax + halo orange
    document.addEventListener('mousemove', (e) => {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const dx = (e.clientX - cx) / cx;
        const dy = (e.clientY - cy) / cy;

        card.style.transform = `translateZ(40px) rotateY(${dx * 6}deg) rotateX(${dy * -4}deg)`;
        floatingLogo.style.transform = `translateZ(${60 + Math.abs(dx * 20)}px) rotateY(${dx * -12}deg) translateY(${dy * -6}px)`;

        // mise à jour halo orange
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
        effectLayer.style.setProperty('--x', x + '%');
        effectLayer.style.setProperty('--y', y + '%');
    });

    // Reset quand la souris sort
    document.addEventListener('mouseleave', () => {
        card.style.transform = '';
        floatingLogo.style.transform = '';
    });
})();

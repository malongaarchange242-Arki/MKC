(() => {
    // Éléments du DOM
    const form = document.getElementById('forgotForm');
    const steps = {
        1: document.getElementById('email-step'),
        2: document.getElementById('otp-step'),
        3: document.getElementById('password-step')
    };

    const mainBtn = document.getElementById('mainBtn');
    const title = document.getElementById('title');
    const subtitle = document.getElementById('step-desc');
    const message = document.getElementById('message');
    const otpFields = document.querySelectorAll('.otp-field');
    const card = document.querySelector('.card');
    const floatingLogo = document.querySelector('.floating-logo');

    // Éléments Mot de passe
    const togglePassBtn = document.getElementById('togglePassBtn');
    const passInputs = document.querySelectorAll('.pass-input');

    let currentStep = 1;

    // --- 1. GESTION MOT DE PASSE (OEIL) ---
    if (togglePassBtn) {
        togglePassBtn.addEventListener('click', () => {
            // Vérifie l'état actuel du premier champ
            const isPassword = passInputs[0].getAttribute('type') === 'password';
            const type = isPassword ? 'text' : 'password';

            // Applique le changement aux DEUX champs
            passInputs.forEach(input => input.setAttribute('type', type));

            // Change l'icône
            togglePassBtn.textContent = isPassword ? '🙈' : '👁️';
        });
    }

    // --- 2. LOGIQUE OTP (Focus & Sécurité) ---
    otpFields.forEach((field, index) => {
        field.addEventListener('input', (e) => {
            // Force uniquement les chiffres
            e.target.value = e.target.value.replace(/[^0-9]/g, '');

            // Focus automatique vers la droite
            if (e.target.value && index < otpFields.length - 1) {
                otpFields[index + 1].focus();
            }
        });

        field.addEventListener('keydown', (e) => {
            // Focus arrière sur Backspace
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                otpFields[index - 1].focus();
            }
        });
    });

    // --- 3. SOUMISSION DU FORMULAIRE ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        message.textContent = '';
        message.style.color = 'var(--muted)';

            // ÉTAPE 1 : EMAIL -> Envoi du magic link
            if (currentStep === 1) {
                const emailInput = document.getElementById('email').value;
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
                    setError('Email invalide.');
                    return;
                }

                setLoading(true, 'Envoi du lien...');
                try {
                    const API_BASE = (window && window.__API_BASE__) || 'https://mkc-backend-kqov.onrender.com/auth';
                    const resp = await fetch(`${API_BASE}/magic/request`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: emailInput, redirect: '/reset_password.html' })
                    });
                    // don't reveal existence; show generic message
                    message.style.color = 'var(--muted)';
                    message.textContent = 'Si un compte existe, vous recevrez un email contenant un lien pour réinitialiser votre mot de passe.';
                    // disable inputs to avoid re-submit
                    document.getElementById('email').disabled = true;
                    mainBtn.disabled = true;
                    mainBtn.textContent = 'Envoyé';
                } catch (e) {
                    setError('Erreur lors de l’envoi. Réessayez.');
                    setLoading(false);
                    return;
                }
                setLoading(false);
                return;

            // ÉTAPE 2 : OTP -> PASSWORD
        } else if (currentStep === 2) {
            const code = Array.from(otpFields).map(f => f.value).join('');
            if (code.length < 6) {
                setError('Code incomplet (6 chiffres requis).');
                return;
            }

            setLoading(true, 'Vérification...');
            await wait(1000);

            switchStep(3, "Sécurité", "Définissez votre nouveau mot de passe");
            mainBtn.textContent = "Réinitialiser";
            setLoading(false);

            // ÉTAPE 3 : FINALISATION
        } else {
            const p1 = document.getElementById('new-password').value;
            const p2 = document.getElementById('confirm-password').value;

            if (p1.length < 8) {
                setError('Le mot de passe doit faire 8 caractères minimum.');
                return;
            }
            if (p1 !== p2) {
                setError('Les mots de passe ne correspondent pas.');
                return;
            }

            setLoading(true, '');
            message.style.color = 'var(--success)';
            message.textContent = 'Succès ! Redirection en cours...';

            await wait(2000);
            window.location.href = 'index.html';
        }
    });

    // --- UTILS ---
    function switchStep(stepNum, titleText, subText) {
        steps[currentStep].classList.add('hidden'); // Masque l'actuel
        steps[stepNum].classList.remove('hidden');  // Affiche le suivant
        title.textContent = titleText;
        subtitle.textContent = subText;
        currentStep = stepNum;
        message.textContent = '';
    }

    function setError(msg) {
        message.style.color = 'var(--danger)';
        message.textContent = msg;
    }

    function setLoading(isLoading, msg) {
        mainBtn.disabled = isLoading;
        if (msg) message.textContent = msg;
    }

    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    // --- EFFET PARALLAX 3D ---
    document.addEventListener('mousemove', (e) => {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const dx = (e.clientX - cx) / cx;
        const dy = (e.clientY - cy) / cy;

        card.style.transform = `translateZ(40px) rotateY(${dx * 6}deg) rotateX(${dy * -4}deg)`;
        floatingLogo.style.transform = `translateZ(60px) rotateY(${dx * -12}deg) translateY(${dy * -6}px)`;
    });

    document.addEventListener('mouseleave', () => {
        card.style.transform = '';
        floatingLogo.style.transform = '';
    });
})();
/* ==========================================================
   Lumi5 Labs — shared front-end script
   Handles: quick-demo role select (index.html),
            sign up (signup.html), sign in (signin.html)
   ========================================================== */

// Same pattern used in js/messages.js — override with
// window.LUMILABS_API_BASE if the backend runs elsewhere.
const API_BASE = window.LUMILABS_API_BASE || 'http://localhost:3000/api';

/* ----------------------------------------------------------
   Quick demo (existing prototype shortcut on index.html)
   ---------------------------------------------------------- */
function selectRole(role) {
  const users = {
    beta: { key: 'beta', name: 'Beta', role: 'business_owner' },
    alpha: { key: 'alpha', name: 'Alpha', role: 'investor' },
    victor: { key: 'victor', name: 'Victor', role: 'admin' },
  };

  const destinations = {
    beta:   'businessownerdashboard.html',
    alpha:  'investordashboard.html',
    victor: 'moderatordashboard.html',
  };

  const dest = destinations[role];
  if (dest) {
    localStorage.setItem('lumilabsSelectedUser', JSON.stringify(users[role]));
    window.location.href = dest;
  }
}

/* ----------------------------------------------------------
   Shared auth helpers
   ---------------------------------------------------------- */

// Maps a backend role to where a signed-in user should land,
// and to the "key" used throughout the rest of the prototype
// (see PROTOTYPE_USERS in businessownerdashboard.html etc).
const ROLE_MAP = {
  business_owner: { key: 'beta',   dashboard: 'businessownerdashboard.html' },
  investor:       { key: 'alpha',  dashboard: 'investordashboard.html' },
  admin:          { key: 'victor', dashboard: 'moderatordashboard.html' },
};

async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error('Could not reach the server. Please check your connection and try again.');
  }

  let data = {};
  try {
    data = await response.json();
  } catch (err) {
    data = {};
  }

  if (!response.ok) {
    const message =
      (data.errors && data.errors[0] && data.errors[0].msg) ||
      data.error ||
      'Something went wrong. Please try again.';
    throw new Error(message);
  }

  return data;
}

// Persists the session the same way the rest of the app expects
// it (see js/messages.js -> getAuthToken / getSelectedUser, and
// js/mybusinesses.js / js/createportfolio.js -> lumilabsSelectedUser).
function saveSession(token, user) {
  const mapped = ROLE_MAP[user.role] || { key: user.role, dashboard: 'index.html' };
  localStorage.setItem('lumilabsToken', token);
  localStorage.setItem(
    'lumilabsSelectedUser',
    JSON.stringify({ key: mapped.key, name: user.name, role: user.role, id: user.id })
  );
  return mapped;
}

function showMessage(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = `form-message show ${type}`;
}

function hideMessage(el) {
  if (!el) return;
  el.className = 'form-message';
  el.textContent = '';
}

function setFieldError(groupEl, errorEl, message) {
  if (!groupEl) return;
  if (message) {
    groupEl.classList.add('has-error');
    if (errorEl) errorEl.textContent = message;
  } else {
    groupEl.classList.remove('has-error');
    if (errorEl) errorEl.textContent = '';
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/* ----------------------------------------------------------
   SIGN UP PAGE
   Business owners get a real account then are handed off to
   createportfolio.html to build their startup profile (which
   already covers Company Info / MVP status / documents, etc).
   Investors just need the basic account fields.
   ---------------------------------------------------------- */
function initSignupPage() {
  const form = document.getElementById('signup-form');
  if (!form) return;

  const roleButtons = document.querySelectorAll('.role-toggle-btn');
  const roleInput = document.getElementById('role-input');
  const submitBtn = document.getElementById('signup-submit-btn');
  const messageEl = document.getElementById('signup-message');

  const hintEl = document.getElementById('role-hint');

  function setRole(role) {
    roleInput.value = role;
    roleButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.role === role));
    submitBtn.textContent = role === 'business_owner' ? 'Create Account & Add Startup' : 'Create Account';
    if (hintEl) {
      hintEl.textContent =
        role === 'business_owner'
          ? "After signing up you'll be taken straight to building your startup portfolio."
          : "After signing up you'll land on your investor dashboard to start browsing startups.";
    }
  }

  roleButtons.forEach((btn) => {
    btn.addEventListener('click', () => setRole(btn.dataset.role));
  });

  // Default to Business Owner.
  setRole(roleInput.value || 'business_owner');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideMessage(messageEl);

    const name = document.getElementById('su-name');
    const email = document.getElementById('su-email');
    const password = document.getElementById('su-password');
    const confirmPassword = document.getElementById('su-confirm-password');

    let valid = true;

    setFieldError(name.closest('.form-group'), document.getElementById('su-name-error'), '');
    if (!name.value.trim()) {
      setFieldError(name.closest('.form-group'), document.getElementById('su-name-error'), 'Full name is required.');
      valid = false;
    }

    setFieldError(email.closest('.form-group'), document.getElementById('su-email-error'), '');
    if (!isValidEmail(email.value.trim())) {
      setFieldError(email.closest('.form-group'), document.getElementById('su-email-error'), 'Enter a valid email address.');
      valid = false;
    }

    setFieldError(password.closest('.form-group'), document.getElementById('su-password-error'), '');
    if (password.value.length < 6) {
      setFieldError(password.closest('.form-group'), document.getElementById('su-password-error'), 'Password must be at least 6 characters.');
      valid = false;
    }

    setFieldError(confirmPassword.closest('.form-group'), document.getElementById('su-confirm-password-error'), '');
    if (confirmPassword.value !== password.value) {
      setFieldError(confirmPassword.closest('.form-group'), document.getElementById('su-confirm-password-error'), 'Passwords do not match.');
      valid = false;
    }

    if (!valid) {
      showMessage(messageEl, 'Please fix the highlighted fields and try again.', 'error');
      return;
    }

    const role = roleInput.value;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    try {
      const { token, user } = await apiPost('/auth/register', {
        name: name.value.trim(),
        email: email.value.trim(),
        password: password.value,
        role,
      });

      const mapped = saveSession(token, user);
      showMessage(messageEl, 'Account created! Redirecting…', 'success');

      // Business owners go straight into building their first
      // portfolio; investors land on their dashboard.
      window.location.href = role === 'business_owner' ? 'createportfolio.html' : mapped.dashboard;
    } catch (err) {
      showMessage(messageEl, err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = role === 'business_owner' ? 'Create Account & Add Startup' : 'Create Account';
    }
  });
}

/* ----------------------------------------------------------
   SIGN IN PAGE
   ---------------------------------------------------------- */
function initSigninPage() {
  const form = document.getElementById('signin-form');
  if (!form) return;

  const submitBtn = document.getElementById('signin-submit-btn');
  const messageEl = document.getElementById('signin-message');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideMessage(messageEl);

    const email = document.getElementById('si-email');
    const password = document.getElementById('si-password');

    let valid = true;

    setFieldError(email.closest('.form-group'), document.getElementById('si-email-error'), '');
    if (!isValidEmail(email.value.trim())) {
      setFieldError(email.closest('.form-group'), document.getElementById('si-email-error'), 'Enter a valid email address.');
      valid = false;
    }

    setFieldError(password.closest('.form-group'), document.getElementById('si-password-error'), '');
    if (!password.value) {
      setFieldError(password.closest('.form-group'), document.getElementById('si-password-error'), 'Password is required.');
      valid = false;
    }

    if (!valid) {
      showMessage(messageEl, 'Please fix the highlighted fields and try again.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    try {
      const { token, user } = await apiPost('/auth/login', {
        email: email.value.trim(),
        password: password.value,
      });

      const mapped = saveSession(token, user);
      showMessage(messageEl, 'Signed in! Redirecting…', 'success');
      window.location.href = mapped.dashboard;
    } catch (err) {
      showMessage(messageEl, err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSignupPage();
  initSigninPage();
});

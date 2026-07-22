const API_BASE = window.LUMILABS_API_BASE || '/api';


const ROLE_MAP = {
  business_owner: { dashboard: 'businessownerdashboard.html' },
  investor: { dashboard: 'investordashboard.html' },
  relationship_manager: { dashboard: 'relationshipmanagerdashboard.html' },
  admin: { dashboard: 'moderatordashboard.html' },
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

function saveSession(token, user) {
  const mapped = ROLE_MAP[user.role] || { dashboard: 'index.html' };
  localStorage.setItem('lumilabsToken', token);
  localStorage.setItem('lumilabsUser', JSON.stringify(user));
  localStorage.removeItem('lumilabsSelectedUser');
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

  // Pre-select based on ?role=business_owner|investor in the URL
  // (used by the homepage's "Sign Up as..." buttons); otherwise
  // default to Business Owner.
  const params = new URLSearchParams(window.location.search);
  const requestedRole = params.get('role');
  setRole(requestedRole === 'investor' ? 'investor' : 'business_owner');

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

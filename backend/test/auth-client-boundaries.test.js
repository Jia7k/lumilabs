const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'script.js'),
  'utf8',
);

function classList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    toggle(value, force) {
      if (force === undefined ? !values.has(value) : force) values.add(value);
      else values.delete(value);
    },
    contains(value) { return values.has(value); },
  };
}

function authHarness(page) {
  const hooks = {
    fetches: [],
    listeners: {},
  };
  const elements = new Map();
  const makeElement = (id, value = '') => {
    const group = { classList: classList() };
    return {
      id,
      value,
      textContent: '',
      disabled: false,
      dataset: {},
      className: '',
      classList: classList(),
      closest() { return group; },
      addEventListener(type, listener) {
        hooks.listeners[`${id}:${type}`] = listener;
      },
    };
  };
  const ids = page === 'signup'
    ? [
      'signup-form',
      'role-input',
      'signup-submit-btn',
      'signup-message',
      'role-hint',
      'su-name',
      'su-name-error',
      'su-email',
      'su-email-error',
      'su-password',
      'su-password-error',
      'su-confirm-password',
      'su-confirm-password-error',
    ]
    : [
      'signin-form',
      'signin-submit-btn',
      'signin-message',
      'si-email',
      'si-email-error',
      'si-password',
      'si-password-error',
    ];
  for (const id of ids) elements.set(id, makeElement(id));
  if (page === 'signup') elements.get('role-input').value = 'business_owner';

  const roleButtons = ['business_owner', 'investor'].map((role) => {
    const button = makeElement(`role-${role}`);
    button.dataset.role = role;
    return button;
  });
  const document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      return selector === '.role-toggle-btn' ? roleButtons : [];
    },
    addEventListener(type, listener) {
      hooks.listeners[`document:${type}`] = listener;
    },
  };
  const context = vm.createContext({
    window: {
      LUMILABS_API_BASE: '/api',
      location: { search: '', href: '' },
    },
    document,
    URLSearchParams,
    fetch: async (url, options) => {
      hooks.fetches.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            token: 'test-token',
            user: {
              id: 1,
              email: 'user@example.test',
              name: 'Boundary User',
              role: page === 'signup'
                ? elements.get('role-input').value
                : 'investor',
            },
          };
        },
      };
    },
    localStorage: {
      setItem() {},
      removeItem() {},
    },
    console,
    Set,
  });
  vm.runInContext(source, context);
  hooks.listeners['document:DOMContentLoaded']();

  return {
    elements,
    hooks,
    async submit() {
      await hooks.listeners[`${page}-form:submit`]({
        preventDefault() {},
      });
    },
  };
}

function fillValidSignup(client, overrides = {}) {
  const values = {
    'su-name': 'Boundary User',
    'su-email': 'boundary@example.test',
    'su-password': 'secret1',
    'su-confirm-password': 'secret1',
    ...overrides,
  };
  for (const [id, value] of Object.entries(values)) {
    client.elements.get(id).value = value;
  }
  return values;
}

test('overlong signup name preserves fields and stops before fetch', async () => {
  const client = authHarness('signup');
  const values = fillValidSignup(client, { 'su-name': 'n'.repeat(101) });

  await client.submit();

  assert.equal(client.hooks.fetches.length, 0);
  assert.match(client.elements.get('su-name-error').textContent, /at most 100/i);
  for (const [id, value] of Object.entries(values)) {
    assert.equal(client.elements.get(id).value, value);
  }
});

test('overlong signup email stops before fetch with an email-field error', async () => {
  const client = authHarness('signup');
  fillValidSignup(client, {
    'su-email': `${'a'.repeat(245)}@example.test`,
  });

  await client.submit();

  assert.equal(client.hooks.fetches.length, 0);
  assert.match(client.elements.get('su-email-error').textContent, /at most 255/i);
});

test('overlong signin email stops before fetch with an email-field error', async () => {
  const client = authHarness('signin');
  client.elements.get('si-email').value = `${'a'.repeat(245)}@example.test`;
  client.elements.get('si-password').value = 'secret1';

  await client.submit();

  assert.equal(client.hooks.fetches.length, 0);
  assert.match(client.elements.get('si-email-error').textContent, /at most 255/i);
});

test('exact 100-character signup name proceeds through the existing API path', async () => {
  const client = authHarness('signup');
  fillValidSignup(client, { 'su-name': 'n'.repeat(100) });

  await client.submit();

  assert.equal(client.hooks.fetches.length, 1);
  assert.equal(client.hooks.fetches[0].url, '/api/auth/register');
  assert.equal(
    JSON.parse(client.hooks.fetches[0].options.body).name,
    'n'.repeat(100),
  );
});

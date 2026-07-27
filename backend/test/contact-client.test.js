const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'contact.js'),
  'utf8',
).replace(/\ninitializeContactForm\(\);\s*$/, '\n');

function element(value = '') {
  return {
    value,
    disabled: false,
    readOnly: false,
    textContent: '',
    className: '',
    attributes: {},
    listeners: {},
    focused: 0,
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    setAttribute(name, nextValue) {
      this.attributes[name] = String(nextValue);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    focus() {
      this.focused += 1;
    },
  };
}

function formHarness({
  apiResult = { message: 'Message received' },
  submitContact,
} = {}) {
  const ids = [
    'contact-form',
    'contact-name',
    'contact-name-error',
    'contact-email',
    'contact-email-error',
    'contact-message',
    'contact-message-error',
    'contact-company-website',
    'contact-submit',
    'contact-status',
  ];
  const nodes = new Map(ids.map((id) => [id, element()]));
  const form = nodes.get('contact-form');
  nodes.get('contact-submit').textContent = 'Send Message';
  nodes.get('contact-status').className = 'form-message';
  form.reset = () => {
    for (const id of [
      'contact-name',
      'contact-email',
      'contact-message',
      'contact-company-website',
    ]) {
      nodes.get(id).value = '';
    }
  };
  const calls = [];
  const api = {
    async submitContact(payload) {
      calls.push(payload);
      if (submitContact) return submitContact(payload);
      if (apiResult instanceof Error) throw apiResult;
      return apiResult;
    },
  };
  const root = { getElementById: (id) => nodes.get(id) || null };
  const context = vm.createContext({ document: root, API: api, console });
  vm.runInContext(source, context);
  context.initializeContactForm({ root, api });
  return {
    calls,
    context,
    nodes,
    input() {
      form.listeners.input({ target: form });
    },
    userInput(id, value) {
      const node = nodes.get(id);
      if (node.readOnly) return false;
      node.value = value;
      form.listeners.input({ target: node });
      return true;
    },
    async submit() {
      await form.listeners.submit({ preventDefault() {} });
    },
  };
}

function fillValidRequiredFields(client) {
  client.nodes.get('contact-name').value = 'Visitor';
  client.nodes.get('contact-email').value = 'visitor@example.com';
}

test('button eligibility follows all field rules without showing errors while typing', () => {
  const client = formHarness();
  const button = client.nodes.get('contact-submit');
  assert.equal(button.disabled, true);

  fillValidRequiredFields(client);
  client.input();

  assert.equal(button.disabled, false);
  assert.equal(client.nodes.get('contact-name-error').textContent, '');
  assert.equal(client.nodes.get('contact-email-error').textContent, '');

  client.nodes.get('contact-message').value = '界'.repeat(5001);
  client.input();
  assert.equal(button.disabled, true);
  assert.equal(client.nodes.get('contact-message-error').textContent, '');
});

test('invalid submit renders field guidance and focuses the first invalid field', async () => {
  const client = formHarness();
  client.nodes.get('contact-name').value = ' ';
  client.nodes.get('contact-email').value = 'invalid';
  await client.submit();

  assert.equal(client.calls.length, 0);
  assert.equal(client.nodes.get('contact-name-error').textContent, 'Enter your name.');
  assert.equal(
    client.nodes.get('contact-email-error').textContent,
    'Enter a valid email address.',
  );
  assert.equal(client.nodes.get('contact-name').attributes['aria-invalid'], 'true');
  assert.equal(client.nodes.get('contact-email').attributes['aria-invalid'], 'true');
  assert.equal(client.nodes.get('contact-name').focused, 1);
  assert.equal(client.nodes.get('contact-status').focused, 0);
});

test('typing clears rendered feedback without moving focus', async () => {
  const client = formHarness();
  client.nodes.get('contact-name').value = ' ';
  client.nodes.get('contact-email').value = 'invalid';
  await client.submit();

  client.nodes.get('contact-name').value = 'Visitor';
  client.nodes.get('contact-email').value = 'visitor@example.com';
  client.input();

  assert.equal(client.nodes.get('contact-name-error').textContent, '');
  assert.equal(client.nodes.get('contact-email-error').textContent, '');
  assert.equal('aria-invalid' in client.nodes.get('contact-name').attributes, false);
  assert.equal(client.nodes.get('contact-name').focused, 1);
  assert.equal(client.nodes.get('contact-email').focused, 0);
  assert.equal(client.nodes.get('contact-status').focused, 0);
});

test('success submits once, clears every field and focuses the live status', async () => {
  const client = formHarness();
  client.nodes.get('contact-name').value = ' Visitor ';
  client.nodes.get('contact-email').value = ' visitor@example.com ';
  client.nodes.get('contact-message').value = ' Hello ';
  client.nodes.get('contact-company-website').value = ' ';
  await client.submit();

  assert.deepEqual(
    JSON.parse(JSON.stringify(client.calls)),
    [{
      name: 'Visitor',
      email: 'visitor@example.com',
      message: 'Hello',
      company_website: '',
    }],
  );
  for (const id of [
    'contact-name',
    'contact-email',
    'contact-message',
    'contact-company-website',
  ]) {
    assert.equal(client.nodes.get(id).value, '');
  }
  assert.equal(
    client.nodes.get('contact-status').textContent,
    "Message received. We'll get back to you soon.",
  );
  assert.equal(client.nodes.get('contact-status').className, 'form-message success');
  assert.equal(client.nodes.get('contact-status').focused, 1);
  assert.equal(client.nodes.get('contact-submit').disabled, true);
  assert.equal(client.nodes.get('contact-submit').textContent, 'Send Message');
});

test('failure preserves every value and restores retry state', async () => {
  const client = formHarness({ apiResult: new Error('offline') });
  fillValidRequiredFields(client);
  client.nodes.get('contact-message').value = 'Keep this text';
  client.nodes.get('contact-company-website').value = 'keep-honeypot-value';
  await client.submit();

  assert.equal(client.nodes.get('contact-name').value, 'Visitor');
  assert.equal(client.nodes.get('contact-email').value, 'visitor@example.com');
  assert.equal(client.nodes.get('contact-message').value, 'Keep this text');
  assert.equal(
    client.nodes.get('contact-company-website').value,
    'keep-honeypot-value',
  );
  assert.equal(
    client.nodes.get('contact-status').textContent,
    "We couldn't send your message. Your text is still here—please retry.",
  );
  assert.equal(client.nodes.get('contact-status').className, 'form-message error');
  assert.equal(client.nodes.get('contact-status').focused, 1);
  assert.equal(client.nodes.get('contact-submit').disabled, false);
  assert.equal(client.nodes.get('contact-submit').textContent, 'Send Message');
});

test('pending submission is single-flight and exposes Sending state', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const client = formHarness({ apiResult: pending });
  fillValidRequiredFields(client);

  const first = client.nodes.get('contact-form').listeners.submit({
    preventDefault() {},
  });
  const second = client.nodes.get('contact-form').listeners.submit({
    preventDefault() {},
  });
  await Promise.resolve();

  assert.equal(client.calls.length, 1);
  assert.equal(client.nodes.get('contact-submit').disabled, true);
  assert.equal(client.nodes.get('contact-submit').textContent, 'Sending…');
  for (const id of ['contact-name', 'contact-email', 'contact-message']) {
    assert.equal(client.nodes.get(id).readOnly, true);
  }

  assert.equal(
    client.userInput('contact-message', 'Typed while waiting'),
    false,
  );
  assert.equal(client.nodes.get('contact-message').value, '');
  assert.equal(client.nodes.get('contact-submit').disabled, true);

  release({ message: 'Message received' });
  await Promise.all([first, second]);
  assert.equal(client.calls.length, 1);
  for (const id of ['contact-name', 'contact-email', 'contact-message']) {
    assert.equal(client.nodes.get(id).readOnly, false);
  }
});

test('client validation uses the same exact Unicode boundaries as the server', () => {
  const client = formHarness();
  const validate = client.context.validateContactPayload;
  const email255 = `${'a'.repeat(250)}@e.co`;
  const email256 = `${'a'.repeat(251)}@e.co`;

  assert.deepEqual(
    JSON.parse(JSON.stringify(validate({
      name: '🙂'.repeat(100),
      email: email255,
      message: '界'.repeat(5000),
    }))),
    {},
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(validate({
      name: '🙂'.repeat(101),
      email: email256,
      message: '界'.repeat(5001),
    }))),
    {
      name: 'Name must be 100 characters or fewer.',
      email: 'Email must be 255 characters or fewer.',
      message: 'Message must be 5,000 characters or fewer.',
    },
  );
});

test('client validation safely matches server handling of non-string values', () => {
  const client = formHarness();
  const validate = client.context.validateContactPayload;

  assert.deepEqual(
    JSON.parse(JSON.stringify(validate({
      name: null,
      email: {},
      message: null,
    }))),
    {
      name: 'Enter your name.',
      email: 'Enter your email address.',
      message: 'Message must be text.',
    },
  );
});

test('safe 400 validation fields render without clearing input', async () => {
  const error = Object.assign(new Error('Request failed (400)'), {
    status: 400,
    fields: {
      email: 'Enter a valid email address.',
    },
  });
  const client = formHarness({ apiResult: error });
  fillValidRequiredFields(client);
  client.nodes.get('contact-message').value = 'Keep me';
  await client.submit();

  assert.equal(client.nodes.get('contact-email-error').textContent, error.fields.email);
  assert.equal(client.nodes.get('contact-email').attributes['aria-invalid'], 'true');
  assert.equal(client.nodes.get('contact-email').focused, 1);
  assert.equal(client.nodes.get('contact-message').value, 'Keep me');
  assert.equal(client.nodes.get('contact-status').textContent, '');
  assert.equal(client.nodes.get('contact-submit').disabled, false);
});

for (const [label, error] of [
  ['network rejection', new Error('visitor@example.com is offline')],
  ['429 response', Object.assign(new Error('unsafe rate-limit detail'), { status: 429 })],
  ['500 response', Object.assign(new Error('database leaked PII'), { status: 500 })],
  ['malformed response', Object.assign(new Error('<script>bad response</script>'), {
    status: 201,
  })],
  ['unsafe validation payload', Object.assign(new Error('Request failed (400)'), {
    status: 400,
    fields: { email: '<img src=x onerror=alert(1)>' },
  })],
  ['prototype-key validation payload', Object.assign(new Error('Request failed (400)'), {
    status: 400,
    fields: JSON.parse('{"constructor":"unsafe inherited key"}'),
  })],
]) {
  test(`${label} uses fixed retry guidance without exposing error data`, async () => {
    const client = formHarness({ apiResult: error });
    fillValidRequiredFields(client);
    client.nodes.get('contact-message').value = 'Private visitor text';
    await client.submit();

    const status = client.nodes.get('contact-status');
    assert.equal(
      status.textContent,
      "We couldn't send your message. Your text is still here—please retry.",
    );
    assert.doesNotMatch(status.textContent, /visitor@example|database|script|img|rate-limit/i);
    assert.equal(client.nodes.get('contact-message').value, 'Private visitor text');
    assert.equal(client.nodes.get('contact-submit').disabled, false);
  });
}

test('initialization is a no-op when the Contact form is absent', () => {
  const root = { getElementById: () => null };
  assert.equal(
    vm.runInContext(
      'initializeContactForm({ root: missingRoot, api: API })',
      Object.assign(formHarness().context, { missingRoot: root }),
    ),
    null,
  );
});

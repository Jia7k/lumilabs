const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessagingApp } = require('../messages-server');

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });

  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function readJson(response) {
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body);
}

test('serves health inside the messaging namespace', async (t) => {
  const server = await listen(createMessagingApp());
  t.after(server.close);

  const payload = await readJson(await fetch(`${server.origin}/api/messages/health`));
  assert.deepEqual(payload, { status: 'ok' });
});

test('does not expose unrelated API namespaces', async (t) => {
  const server = await listen(createMessagingApp());
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/health`);
  assert.equal(response.status, 404);
});

const smokeOrigin = process.env.MESSAGES_SMOKE_ORIGIN;

test('deployed API returns Beta and the seeded Alpha conversation', {
  skip: !smokeOrigin,
}, async () => {
  const headers = {
    'X-LumiLabs-Prototype-User': 'beta',
    'X-LumiLabs-Prototype-Name': 'Beta',
    'X-LumiLabs-Prototype-Role': 'business_owner',
  };

  const user = await readJson(await fetch(`${smokeOrigin}/api/messages/me`, { headers }));
  assert.equal(Number(user.id), 3);

  const conversations = await readJson(
    await fetch(`${smokeOrigin}/api/messages/conversations`, { headers })
  );
  const alpha = conversations.find((row) => Number(row.partner_id) === 2);
  assert.ok(alpha, 'Expected the seeded Alpha conversation');
  assert.equal(Number(alpha.id), 3);
  assert.match(alpha.content, /currently raising/i);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

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

test('serves the unified API health endpoint', async (t) => {
  const server = await listen(createApp());
  t.after(server.close);

  const payload = await readJson(await fetch(`${server.origin}/api/health`));
  assert.deepEqual(payload, { status: 'ok' });
});

test('returns JSON for unknown unified API routes', async (t) => {
  const server = await listen(createApp());
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/not-a-route`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Route not found' });
});

test('mounts the relationship-manager API behind authentication', async (t) => {
  const server = await listen(createApp());
  t.after(server.close);

  const response = await fetch(`${server.origin}/api/relationship-manager/dashboard`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Access token required' });
});

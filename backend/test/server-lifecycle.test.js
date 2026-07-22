const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../server');

function validEnvironment() {
  return {
    JWT_SECRET: 'server-lifecycle-secret',
    DB_USER: 'test-user',
    DB_PASSWORD: 'test-password',
    DB_NAME: 'test-database',
    HOST: '127.0.0.1',
    PORT: '0',
  };
}

test('graceful close ends database connections before the SSH tunnel', async (t) => {
  t.mock.method(console, 'log', () => {});
  const termListeners = process.listenerCount('SIGTERM');
  const interruptListeners = process.listenerCount('SIGINT');
  const events = [];
  const database = {
    async query() {
      return [[], []];
    },
    async end() {
      events.push('database');
    },
  };
  const tunnel = {
    async close() {
      events.push('tunnel');
    },
  };

  const runtime = await main({
    environment: validEnvironment(),
    database,
    openTunnel: async () => tunnel,
  });
  await runtime.close();

  assert.deepEqual(events, ['database', 'tunnel']);
  assert.equal(process.listenerCount('SIGTERM'), termListeners);
  assert.equal(process.listenerCount('SIGINT'), interruptListeners);
});

test('a database close error does not prevent tunnel cleanup', async (t) => {
  t.mock.method(console, 'log', () => {});
  const events = [];
  const database = {
    async end() {
      events.push('database');
      throw new Error('database close failed');
    },
  };
  const tunnel = {
    async close() {
      events.push('tunnel');
    },
  };

  const runtime = await main({
    environment: validEnvironment(),
    database,
    openTunnel: async () => tunnel,
  });
  await assert.rejects(runtime.close(), /database close failed/);
  assert.deepEqual(events, ['database', 'tunnel']);
});

test('startup failure releases the database and tunnel', async () => {
  const events = [];
  const database = {
    async end() {
      events.push('database');
    },
  };
  const tunnel = {
    async close() {
      events.push('tunnel');
    },
  };

  await assert.rejects(
    main({
      environment: validEnvironment(),
      database,
      openTunnel: async () => tunnel,
      createApplication: () => {
        throw new Error('application construction failed');
      },
    }),
    /application construction failed/,
  );
  assert.deepEqual(events, ['database', 'tunnel']);
});

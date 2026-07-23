const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHarness, deferred, flush } = require('./helpers/admin-dashboard-harness');

test('manager failure does not blank a successful moderation section', async () => {
  const client = adminHarness({
    getRelationshipManagers: async () => {
      throw new Error('directory offline');
    },
  });

  await client.init();

  assert.equal(client.element('stat-pending').innerText, 1);
  assert.match(client.element('queue-list').innerHTML, /New Company/);
  assert.match(client.element('manager-directory-status').textContent, /directory/i);
  assert.equal(client.element('manager-directory-retry-btn').hidden, false);
  assert.equal(client.element('rm-submit').disabled, false);
});

test('first moderation failure shows placeholders while manager directory remains usable', async () => {
  const client = adminHarness({
    getStats: async () => {
      throw new Error('stats offline');
    },
    getRelationshipManagers: async () => [{
      name: 'Manager',
      email: 'manager@example.com',
      role: 'relationship_manager',
      created_at: '2026-07-23T00:00:00.000Z',
    }],
  });

  await client.init();

  assert.equal(client.element('stat-pending').innerText, '—');
  assert.match(client.element('queue-list').innerHTML, /load the moderation queue/i);
  assert.match(client.element('rm-account-list').innerHTML, /Manager/);
  assert.equal(client.element('rm-submit').disabled, false);
});

test('empty moderation retains stats and renders intentional queue and manager rows', async () => {
  const client = adminHarness({ getQueue: async () => [] });
  await client.init();

  assert.equal(client.element('stat-approved').innerText, 2);
  assert.match(client.element('queue-list').innerHTML, /No portfolios are waiting for review/);
  assert.match(client.element('rm-account-list').innerHTML, /No relationship manager accounts/);
});

test('initial requests expose section-scoped loading without disabling account creation', async () => {
  const stats = deferred();
  const queue = deferred();
  const managers = deferred();
  const client = adminHarness({
    getStats: async () => stats.promise,
    getQueue: async () => queue.promise,
    getRelationshipManagers: async () => managers.promise,
  });

  const initial = client.init();
  await flush();
  assert.match(client.element('moderation-status').textContent, /Loading moderation/i);
  assert.match(client.element('queue-list').innerHTML, /Loading portfolios/i);
  assert.match(client.element('manager-directory-status').textContent, /Loading manager/i);
  assert.match(client.element('rm-account-list').innerHTML, /Loading manager accounts/i);
  assert.equal(client.element('rm-submit').disabled, false);

  stats.resolve({ pending: 0, approved: 2, rejected: 0, total_matches: 3 });
  queue.resolve([]);
  managers.resolve([]);
  await initial;
});

test('failed moderation refresh preserves one visibly stale disabled snapshot', async () => {
  const client = adminHarness();
  await client.init();
  client.api.getStats = async () => {
    throw new Error('refresh offline');
  };

  assert.equal(await client.run('loadModeration()'), false);
  assert.match(client.element('moderation-status').className, /stale/);
  assert.match(client.element('moderation-status').textContent, /last loaded/i);
  assert.match(client.element('queue-list').innerHTML, /disabled/);
  assert.match(client.element('queue-list').innerHTML, /New Company/);
});

test('moderation retry refreshes only moderation and ignores an older response', async () => {
  const oldStats = deferred();
  const oldQueue = deferred();
  let statsCalls = 0;
  let queueCalls = 0;
  const client = adminHarness({
    getStats: async () => (++statsCalls === 1 ? oldStats.promise : {
      pending: 1, approved: 9, rejected: 0, total_matches: 3,
    }),
    getQueue: async () => (++queueCalls === 1 ? oldQueue.promise : [{
      id: 99,
      name: 'Newest',
      owner_name: 'Owner',
      sector: 'Health',
      submitted_at: null,
      readiness_score: 70,
    }]),
  });

  const initial = client.init();
  await flush();
  const retry = client.run('loadModeration()');
  await retry;
  oldStats.resolve({ pending: 1, approved: 1, rejected: 0, total_matches: 1 });
  oldQueue.resolve([{ id: 1, name: 'Old', owner_name: 'Old', sector: 'Old' }]);
  await initial;

  assert.equal(client.element('stat-approved').innerText, 9);
  assert.match(client.element('queue-list').innerHTML, /Newest/);
  assert.doesNotMatch(client.element('queue-list').innerHTML, /Old/);
});

test('manager directory ignores an older response and marks a failed refresh stale', async () => {
  const oldManagers = deferred();
  let managerCalls = 0;
  const client = adminHarness({
    getRelationshipManagers: async () => {
      managerCalls += 1;
      if (managerCalls === 1) return oldManagers.promise;
      return [{
        name: 'Newest Manager',
        email: 'newest@example.com',
        role: 'relationship_manager',
      }];
    },
  });

  const initial = client.init();
  await flush();
  await client.run('loadManagerDirectory()');
  oldManagers.resolve([{
    name: 'Old Manager',
    email: 'old@example.com',
    role: 'relationship_manager',
  }]);
  await initial;
  assert.match(client.element('rm-account-list').innerHTML, /Newest Manager/);
  assert.doesNotMatch(client.element('rm-account-list').innerHTML, /Old Manager/);

  client.api.getRelationshipManagers = async () => {
    throw new Error('directory refresh offline');
  };
  assert.equal(await client.run('loadManagerDirectory()'), false);
  assert.match(client.element('manager-directory-status').className, /stale/);
  assert.match(client.element('rm-account-list').innerHTML, /Newest Manager/);
});

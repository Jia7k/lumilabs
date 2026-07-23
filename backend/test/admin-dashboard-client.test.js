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

test('manager creation is single-flight and preserves fields while pending', async () => {
  const create = deferred();
  const client = adminHarness({
    createRelationshipManager: async () => create.promise,
  });
  await client.init();
  client.element('rm-name').value = 'New Manager';
  client.element('rm-email').value = 'new.manager@example.com';
  client.element('rm-password').value = '123456';

  const first = client.element('rm-account-form').dispatch('submit');
  const second = client.element('rm-account-form').dispatch('submit');
  await flush();

  assert.equal(client.calls.createRelationshipManager.length, 1);
  assert.equal(client.element('rm-submit').disabled, true);
  assert.equal(client.element('rm-name').value, 'New Manager');
  assert.equal(client.element('rm-email').value, 'new.manager@example.com');
  create.resolve({ id: 10 });
  await Promise.all([first, second]);
});

test('created account plus failed directory refresh retries GET without repeating POST', async () => {
  let directoryCalls = 0;
  const client = adminHarness({
    getRelationshipManagers: async () => {
      directoryCalls += 1;
      if (directoryCalls === 1) return [];
      if (directoryCalls === 2) throw new Error('refresh failed');
      return [{
        name: 'New Manager',
        email: 'new.manager@example.com',
        role: 'relationship_manager',
      }];
    },
  });
  await client.init();
  client.element('rm-name').value = 'New Manager';
  client.element('rm-email').value = 'new.manager@example.com';
  client.element('rm-password').value = '123456';

  await client.element('rm-account-form').dispatch('submit');
  assert.equal(client.calls.createRelationshipManager.length, 1);
  assert.match(client.element('rm-form-message').textContent, /created.*could not refresh/i);
  assert.equal(client.element('rm-password').value, '');

  await client.element('manager-directory-retry-btn').dispatch('click');
  assert.equal(client.calls.createRelationshipManager.length, 1);
  assert.equal(client.calls.getRelationshipManagers.length, 3);
  assert.match(client.element('rm-account-list').innerHTML, /New Manager/);
});

test('manager creation failure keeps every entered field and restores submit', async () => {
  const client = adminHarness({
    createRelationshipManager: async () => {
      throw new Error('email already exists');
    },
  });
  await client.init();
  client.element('rm-name').value = 'New Manager';
  client.element('rm-email').value = 'new.manager@example.com';
  client.element('rm-password').value = '123456';

  await client.element('rm-account-form').dispatch('submit');

  assert.equal(client.element('rm-name').value, 'New Manager');
  assert.equal(client.element('rm-email').value, 'new.manager@example.com');
  assert.equal(client.element('rm-password').value, '123456');
  assert.equal(client.element('rm-submit').disabled, false);
  assert.match(client.element('rm-form-message').textContent, /already exists/i);
});

test('delegated Review normalizes a string ID and opens loading before detail resolves', async () => {
  const detail = deferred();
  const client = adminHarness({
    getQueue: async () => [{
      id: '42',
      name: 'String ID Company',
      owner_name: 'Owner',
      sector: 'Technology',
      readiness_score: 60,
    }],
    getPortfolio: async () => detail.promise,
  });
  await client.init();
  const trigger = client.element('review-trigger');
  trigger.dataset.portfolioId = '42';

  const click = client.element('queue-list').dispatch('click', { target: trigger });
  await flush();

  assert.equal(client.calls.getPortfolio.length, 1);
  assert.equal(client.calls.getPortfolio[0][0], 42);
  assert.equal(client.element('review-overlay').classList.contains('open'), true);
  assert.match(client.element('review-card').innerHTML, /Loading portfolio/);
  assert.equal(client.document.activeElement, client.element('review-card'));

  detail.resolve({
    id: 42,
    name: 'String ID Company',
    sector: 'Technology',
    mvp_status: 'Beta',
    funding_goal: 100000,
    readiness_score: 60,
    documents: [],
  });
  await click;
  assert.match(client.element('review-card').innerHTML, /Approve/);
});

test('invalid or missing queue ID shows visible moderation recovery without a detail call', async () => {
  const client = adminHarness();
  await client.init();
  const trigger = client.element('invalid-review-trigger');
  trigger.dataset.portfolioId = '999';

  await client.element('queue-list').dispatch('click', { target: trigger });

  assert.equal(client.calls.getPortfolio.length, 0);
  assert.match(client.element('moderation-status').textContent, /no longer available/i);
  assert.equal(client.element('moderation-retry-btn').hidden, false);
});

test('detail failure stays open with single-flight Try again and Close', async () => {
  const retry = deferred();
  let detailCalls = 0;
  const client = adminHarness({
    getPortfolio: async () => {
      detailCalls += 1;
      if (detailCalls === 1) throw new Error('detail offline');
      return retry.promise;
    },
  });
  await client.init();
  await client.run("openReviewModal(42, document.getElementById('review-trigger'))");
  assert.match(client.element('review-card').innerHTML, /Try again/);
  assert.equal(client.element('review-overlay').classList.contains('open'), true);

  const retryButton = client.element('review-retry');
  retryButton.dataset.reviewAction = 'retry';
  const first = client.element('review-card').dispatch('click', { target: retryButton });
  const second = client.element('review-card').dispatch('click', { target: retryButton });
  await flush();
  assert.equal(client.calls.getPortfolio.length, 2);

  retry.resolve({
    id: 42,
    name: 'Recovered',
    sector: 'Technology',
    mvp_status: 'Beta',
    funding_goal: 100000,
    readiness_score: 60,
    documents: [],
  });
  await Promise.all([first, second]);
});

test('closed review ignores a late response and restores trigger focus', async () => {
  const detail = deferred();
  const client = adminHarness({ getPortfolio: async () => detail.promise });
  await client.init();
  const trigger = client.element('review-trigger');

  const opening = client.run("openReviewModal(42, document.getElementById('review-trigger'))");
  await flush();
  client.run('closeReviewModal()');
  detail.resolve({
    id: 42,
    name: 'Late',
    sector: 'Technology',
    mvp_status: 'Beta',
    funding_goal: 100000,
    readiness_score: 60,
    documents: [],
  });
  await opening;

  assert.equal(client.element('review-overlay').classList.contains('open'), false);
  assert.doesNotMatch(client.element('review-card').innerHTML, /Late/);
  assert.equal(client.document.activeElement, trigger);
});

test('malformed detail enters the same recoverable modal error state', async () => {
  const client = adminHarness({
    getPortfolio: async () => ({ id: 42, name: 'Broken', documents: null }),
  });
  await client.init();
  await client.run('openReviewModal(42)');

  assert.equal(client.element('review-overlay').classList.contains('open'), true);
  assert.match(client.element('review-card').innerHTML, /couldn.t display/i);
});

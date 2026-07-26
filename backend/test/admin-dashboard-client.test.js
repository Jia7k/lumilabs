const test = require('node:test');
const assert = require('node:assert/strict');
const { adminHarness, deferred, flush } = require('./helpers/admin-dashboard-harness');

test('admin initialization loads moderation only', async () => {
  const page = adminHarness();
  await page.initialize();

  assert.deepEqual(page.apiCalls.sort(), ['getQueue', 'getStats']);
  assert.equal(page.source.includes('createRelationshipManager'), false);
  assert.equal(page.source.includes('getRelationshipManagers'), false);
});

test('first moderation failure shows placeholders and a scoped retry', async () => {
  const client = adminHarness({
    getStats: async () => {
      throw new Error('stats offline');
    },
  });

  await client.init();

  assert.equal(client.element('stat-pending').innerText, '—');
  assert.match(client.element('queue-list').innerHTML, /load the moderation queue/i);
  assert.equal(client.element('moderation-retry-btn').hidden, false);
});

test('empty moderation retains stats and renders an intentional queue row', async () => {
  const client = adminHarness({ getQueue: async () => [] });
  await client.init();

  assert.equal(client.element('stat-approved').innerText, 2);
  assert.match(client.element('queue-list').innerHTML, /No portfolios are waiting for review/);
});

test('initial requests expose section-scoped moderation loading', async () => {
  const stats = deferred();
  const queue = deferred();
  const client = adminHarness({
    getStats: async () => stats.promise,
    getQueue: async () => queue.promise,
  });

  const initial = client.init();
  await flush();
  assert.match(client.element('moderation-status').textContent, /Loading moderation/i);
  assert.match(client.element('queue-list').innerHTML, /Loading portfolios/i);

  stats.resolve({ pending: 0, approved: 2, rejected: 0, total_matches: 3 });
  queue.resolve([]);
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

test('moderator IDs reject unsafe and coercible values while accepting canonical IDs', () => {
  const client = adminHarness();
  const normalize = (candidate) => {
    client.context.candidate = candidate;
    return client.run('normalizePortfolioId(candidate)');
  };

  assert.equal(normalize(42), 42);
  assert.equal(normalize('42'), 42);
  for (const candidate of [
    true,
    [42],
    { valueOf: () => 42 },
    Number.MAX_SAFE_INTEGER + 1,
    '042',
    '1e2',
    '0',
    '-1',
  ]) {
    assert.equal(normalize(candidate), null);
  }
});

test('review documents never expose download URLs and use loaded metadata', async () => {
  const client = adminHarness({
    getPortfolio: async () => ({
      id: 42,
      name: 'New Company',
      sector: 'Technology',
      mvp_status: 'Beta',
      funding_goal: 100000,
      readiness_score: 60,
      documents: [{
        id: 51,
        file_name: '<deck>.pdf',
        download_url: 'javascript:alert(1)',
      }],
    }),
  });
  await client.init();
  await client.run('openReviewModal(42)');

  const html = client.element('review-card').innerHTML;
  assert.doesNotMatch(html, /\bhref\s*=/i);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.match(html, /data-document-id="51"/);
  assert.match(html, /&lt;deck&gt;\.pdf/);

  const download = client.element('review-document');
  download.dataset.documentDownload = '';
  download.dataset.documentId = '51';
  await client.element('review-card').dispatch('click', { target: download });

  assert.deepEqual(client.calls.downloadDocument, [[
    'javascript:alert(1)',
    '<deck>.pdf',
  ]]);
});

test('approval is single-flight, disables both decisions, and refreshes moderation once', async () => {
  const approve = deferred();
  const client = adminHarness({ approvePortfolio: async () => approve.promise });
  await client.init();
  await client.run('openReviewModal(42)');

  const first = client.run('handleApprove()');
  const second = client.run('handleApprove()');
  await flush();
  assert.equal(client.calls.approvePortfolio.length, 1);
  assert.deepEqual(client.calls.approvePortfolio[0], [42]);
  assert.equal(client.element('review-approve-btn').disabled, true);
  assert.equal(client.element('review-reject-btn').disabled, true);
  assert.match(client.element('review-action-status').textContent, /approving/i);

  approve.resolve({});
  await Promise.all([first, second]);
  assert.equal(client.calls.getStats.length, 2);
  assert.equal(client.calls.getQueue.length, 2);
  assert.match(client.element('moderation-status').textContent, /approved/i);
});

test('approval failure keeps the review open and restores controls', async () => {
  const client = adminHarness({
    approvePortfolio: async () => {
      throw new Error('approval failed');
    },
  });
  await client.init();
  await client.run('openReviewModal(42)');
  await client.run('handleApprove()');

  assert.equal(client.element('review-overlay').classList.contains('open'), true);
  assert.equal(client.element('review-approve-btn').disabled, false);
  assert.equal(client.element('review-reject-btn').disabled, false);
  assert.match(client.element('review-action-status').textContent, /approval failed/i);
});

test('blank rejection never calls the API and failed rejection keeps its reason', async () => {
  const client = adminHarness({
    rejectPortfolio: async () => {
      throw new Error('reject failed');
    },
  });
  await client.init();
  await client.run('openReviewModal(42)');
  client.run('openRejectPopup()');

  client.element('reason-textarea').value = '   ';
  await client.run('handleReject()');
  assert.equal(client.calls.rejectPortfolio.length, 0);
  assert.match(client.element('reason-error').textContent, /provide a rejection reason/i);

  client.element('reason-textarea').value = 'Needs stronger traction';
  await client.run('handleReject()');
  assert.equal(client.calls.rejectPortfolio.length, 1);
  assert.equal(client.element('reason-textarea').value, 'Needs stronger traction');
  assert.equal(client.element('reason-textarea').disabled, false);
  assert.match(client.element('reason-error').textContent, /reject failed/i);
});

test('all close paths and duplicate rejection are blocked while rejection is pending', async () => {
  const reject = deferred();
  const client = adminHarness({ rejectPortfolio: async () => reject.promise });
  await client.init();
  await client.run('openReviewModal(42)');
  client.run('openRejectPopup()');
  client.element('reason-textarea').value = 'Needs stronger traction';

  const saving = client.run('handleReject()');
  const duplicate = client.run('handleReject()');
  await flush();
  assert.equal(client.calls.rejectPortfolio.length, 1);
  assert.equal(client.run('closeRejectPopup()'), false);
  assert.equal(client.run('closeReviewModal()'), false);
  await client.element('reason-overlay').dispatch('click', {
    target: client.element('reason-overlay'),
  });
  const closeControl = client.element('review-close-control');
  closeControl.dataset.reviewAction = 'close';
  await client.element('review-card').dispatch('click', { target: closeControl });
  await client.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(client.element('reason-overlay').classList.contains('open'), true);
  assert.equal(client.element('review-overlay').classList.contains('open'), true);
  assert.equal(client.element('reason-cancel-btn').disabled, true);

  reject.resolve({});
  await Promise.all([saving, duplicate]);
});

test('saved decision plus refresh failure disables stale Review without repeating mutation', async () => {
  let statsCalls = 0;
  const client = adminHarness({
    getStats: async () => {
      statsCalls += 1;
      if (statsCalls === 1) {
        return { pending: 1, approved: 2, rejected: 0, total_matches: 3 };
      }
      throw new Error('refresh failed');
    },
  });
  await client.init();
  await client.run('openReviewModal(42)');
  await client.run('handleApprove()');

  assert.equal(client.calls.approvePortfolio.length, 1);
  assert.match(client.element('moderation-status').textContent, /approved/i);
  assert.match(client.element('queue-list').innerHTML, /disabled/);
  await client.element('moderation-retry-btn').dispatch('click');
  assert.equal(client.calls.approvePortfolio.length, 1);
});

test('a successful decision status survives the moderation rerender', async () => {
  const client = adminHarness();
  await client.init();
  await client.run('openReviewModal(42)');
  await client.run('handleApprove()');

  assert.equal(client.element('moderation-status').hidden, false);
  assert.equal(client.element('moderation-status').textContent, 'Portfolio approved.');
  assert.match(client.element('moderation-status').className, /success/);
});

test('moderator queue and review normalize malformed readiness and preserve team zero', async () => {
  const portfolio = {
    id: 42,
    name: 'Malformed Readiness',
    owner_name: 'Owner',
    sector: 'Fintech',
    submitted_at: '2026-01-01T00:00:00.000Z',
    readiness_score: [88],
    monthly_revenue: null,
    user_count: null,
    growth_rate: null,
    market_size: null,
    competitor_analysis: null,
    advisor_names: null,
    burn_rate: null,
    runway_months: null,
  };
  const client = adminHarness({
    getQueue: async () => [portfolio],
    getPortfolio: async () => ({
      ...portfolio,
      mvp_status: 'Beta',
      funding_goal: 1000,
      team_size: 0,
      documents: [],
    }),
  });

  await client.init();
  assert.match(client.element('queue-list').innerHTML, /--score:0/);
  assert.doesNotMatch(client.element('queue-list').innerHTML, /--score:88/);

  await client.run('openReviewModal(42)');
  const html = client.element('review-card').innerHTML;
  assert.match(html, /readiness-score">0\/100/);
  assert.match(html, /Team Size[\s\S]*modal-field-value[^>]*>0</);
  assert.doesNotMatch(html, /No team size provided/);
});

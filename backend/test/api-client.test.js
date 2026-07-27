const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'api.js'),
  'utf8',
);

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function clientHarness({ apiBase } = {}) {
  const values = new Map([
    ['lumilabsToken', 'token'],
    ['lumilabsUser', '{"id":1}'],
    ['lumilabsSelectedUser', '{"id":1}'],
  ]);
  const hooks = {
    removed: [],
    redirects: 0,
    reloads: 0,
    recovery: null,
  };
  const location = {
    _href: 'protected.html',
    get href() {
      return this._href;
    },
    set href(value) {
      this._href = value;
      hooks.redirects += 1;
    },
    reload() {
      hooks.reloads += 1;
    },
  };
  const main = {
    replaceChildren(node) {
      hooks.recovery = node;
    },
  };
  const sandbox = {
    window: { LUMILABS_API_BASE: apiBase, location },
    localStorage: {
      getItem(key) {
        return values.get(key) ?? null;
      },
      removeItem(key) {
        hooks.removed.push(key);
        values.delete(key);
      },
    },
    document: {
      body: main,
      getElementById() {
        return null;
      },
      querySelector() {
        return main;
      },
      createElement() {
        const paragraph = { textContent: '' };
        const button = {
          addEventListener(_name, handler) {
            this.handler = handler;
          },
        };
        return {
          id: '',
          className: '',
          innerHTML: '',
          attributes: {},
          paragraph,
          button,
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
          querySelector(selector) {
            return selector === 'p' ? paragraph : button;
          },
        };
      },
    },
    FormData: class FormData {},
    fetch: async () => response(200, {}),
    console: { error() {}, log() {} },
    setTimeout,
    clearTimeout,
    URL,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  return {
    hooks,
    values,
    context,
    run(code) {
      return vm.runInContext(code, context);
    },
  };
}

test('apiFetch clears all session keys and redirects once on repeated HTTP 401', async () => {
  const client = clientHarness();
  client.context.fetch = async () => response(401, { error: 'Session expired' });

  const results = await Promise.allSettled([
    client.run("apiFetch('/one')"),
    client.run("apiFetch('/two')"),
  ]);

  assert.equal(results.every(({ status }) => status === 'rejected'), true);
  assert.equal(results[0].reason.status, 401);
  assert.equal(results[0].reason.isNetworkError, false);
  assert.deepEqual([...client.values.keys()], []);
  assert.deepEqual(client.hooks.removed, [
    'lumilabsToken',
    'lumilabsUser',
    'lumilabsSelectedUser',
  ]);
  assert.equal(client.hooks.redirects, 1);
  assert.equal(client.context.window.location.href, 'signin.html');
});

for (const status of [403, 500]) {
  test(`apiFetch preserves the session and exposes HTTP ${status}`, async () => {
    const client = clientHarness();
    client.context.fetch = async () => response(status, { error: 'Safe error' });

    await assert.rejects(client.run("apiFetch('/protected')"), (error) => {
      assert.equal(error.message, 'Safe error');
      assert.equal(error.status, status);
      assert.equal(error.isNetworkError, false);
      return true;
    });
    assert.equal(client.values.get('lumilabsToken'), 'token');
    assert.equal(client.hooks.redirects, 0);
  });
}

test('apiFetch classifies a network failure without clearing the session', async () => {
  const client = clientHarness();
  client.context.fetch = async () => {
    throw new TypeError('offline');
  };

  await assert.rejects(client.run("apiFetch('/protected')"), (error) => {
    assert.equal(error.status, null);
    assert.equal(error.isNetworkError, true);
    assert.match(error.message, /reach|connection/i);
    return true;
  });
  assert.equal(client.values.get('lumilabsToken'), 'token');
  assert.equal(client.hooks.redirects, 0);
});

test('apiFetch retains a status fallback when an error body is not JSON', async () => {
  const client = clientHarness();
  client.context.fetch = async () => ({
    ok: false,
    status: 502,
    json: async () => {
      throw new SyntaxError('not JSON');
    },
  });

  await assert.rejects(client.run("apiFetch('/protected')"), (error) => {
    assert.equal(error.status, 502);
    assert.equal(error.message, 'Request failed (502)');
    return true;
  });
  assert.equal(client.values.get('lumilabsToken'), 'token');
});

test('non-Contact request errors do not retain structured response bodies', async () => {
  const client = clientHarness();
  client.context.fetch = async () => response(400, {
    errors: {
      email: 'private@example.com',
      nested: { secret: 'do not retain' },
    },
  });

  await assert.rejects(client.run("API.getCurrentUser()"), (error) => {
    assert.equal(Object.hasOwn(error, 'fields'), false);
    assert.doesNotMatch(JSON.stringify(error), /private|secret|nested/i);
    return true;
  });
});

test('requirePageRole returns a matching authenticated user', async () => {
  const client = clientHarness();
  client.run("API.getCurrentUser = async () => ({ id: 2, role: 'investor' })");

  assert.equal((await client.run("requirePageRole('investor')")).id, 2);
  assert.equal(client.hooks.redirects, 0);
  assert.equal(client.hooks.recovery, null);
});

for (const [role, dashboard] of Object.entries({
  business_owner: 'businessownerdashboard.html',
  investor: 'investordashboard.html',
  relationship_manager: 'relationshipmanagerdashboard.html',
  admin: 'moderatordashboard.html',
  superadmin: 'superadmindashboard.html',
})) {
  test(`wrong-role ${role} is routed to its dashboard without sign-out`, async () => {
    const client = clientHarness();
    client.run(`API.getCurrentUser = async () => ({ id: 2, role: '${role}' })`);

    assert.equal(await client.run("requirePageRole('not_this_role')"), null);
    assert.equal(client.context.window.location.href, dashboard);
    assert.equal(client.values.get('lumilabsToken'), 'token');
    assert.deepEqual(client.hooks.removed, []);
  });
}

test('requirePageRole renders an accessible full-reload Retry for a 500', async () => {
  const client = clientHarness();
  client.run(
    "API.getCurrentUser = async () => { throw new ApiRequestError('down', { status: 500 }); }",
  );

  assert.equal(await client.run("requirePageRole('investor')"), null);
  assert.equal(client.values.get('lumilabsToken'), 'token');
  assert.equal(client.hooks.recovery.attributes.role, 'alert');
  assert.equal(client.hooks.recovery.attributes['aria-live'], 'assertive');
  assert.match(client.hooks.recovery.innerHTML, /Retry/);
  client.hooks.recovery.button.handler();
  assert.equal(client.hooks.reloads, 1);
});

test('requirePageRole preserves credentials and renders Retry for a network failure', async () => {
  const client = clientHarness();
  client.run(
    "API.getCurrentUser = async () => { throw new ApiRequestError('offline', { isNetworkError: true }); }",
  );

  assert.equal(await client.run("requirePageRole('investor')"), null);
  assert.equal(client.values.get('lumilabsToken'), 'token');
  assert.equal(client.hooks.redirects, 0);
  assert.equal(client.hooks.recovery.attributes.role, 'alert');
  assert.match(client.hooks.recovery.paragraph.textContent, /network/i);
});

test('requirePageRole leaves confirmed 401 recovery to the sign-in transition', async () => {
  const client = clientHarness();
  client.run(`
    API.getCurrentUser = async () => {
      redirectToSignIn();
      throw new ApiRequestError('expired', { status: 401 });
    };
  `);

  assert.equal(await client.run("requirePageRole('investor')"), null);
  assert.equal(client.context.window.location.href, 'signin.html');
  assert.equal(client.hooks.recovery, null);
});

test('normalizeReadinessScore rejects coercible values and clamps numeric scores', () => {
  const client = clientHarness();
  const vectors = [
    [null, 0],
    [undefined, 0],
    ['not-a-score', 0],
    [-1, 0],
    ['88', 88],
    [101, 100],
    [true, 0],
    [[88], 0],
    [{}, 0],
    ['   ', 0],
  ];

  for (const [value, expected] of vectors) {
    client.context.readinessCandidate = value;
    assert.equal(
      client.run('normalizeReadinessScore(readinessCandidate)'),
      expected,
      String(value),
    );
  }
});

test('portfolio approval sends PUT without an unused notes body', async () => {
  const client = clientHarness();
  let request;
  client.context.fetch = async (url, options) => {
    request = { url, options };
    return response(200, { status: 'approved' });
  };

  await client.run('API.approvePortfolio(42)');

  assert.equal(request.url, '/api/admin/portfolios/42/approve');
  assert.equal(request.options.method, 'PUT');
  assert.equal(Object.hasOwn(request.options, 'body'), false);
});

test('five-role workflow API methods use the final routes, verbs, and payloads', async () => {
  const client = clientHarness();
  const requests = [];
  client.context.fetch = async (url, options) => {
    requests.push({ url, options });
    return response(200, {});
  };

  await client.run(`
    Promise.all([
      API.getSuperadminStats(),
      API.getPortfolioAssignments(),
      API.getAssignableRelationshipManagers(),
      API.getStaff(),
      API.createStaff({ name: 'Rae', email: 'rae@example.test', password: 'secret1', role: 'admin' }),
      API.assignPortfolioManager(42, 9),
      API.unassignPortfolioManager(42),
      API.getSuperadminAuditLogs(2, 25),
      API.getAssignedPortfolio(42),
      API.removeManagedInvestor(7, 11),
    ])
  `);

  assert.deepEqual(
    requests.map(({ url, options }) => ({
      url,
      method: options.method || 'GET',
      body: options.body,
    })),
    [
      { url: '/api/superadmin/stats', method: 'GET', body: undefined },
      { url: '/api/superadmin/portfolio-assignments', method: 'GET', body: undefined },
      { url: '/api/superadmin/relationship-managers', method: 'GET', body: undefined },
      { url: '/api/superadmin/staff', method: 'GET', body: undefined },
      {
        url: '/api/superadmin/staff',
        method: 'POST',
        body: '{"name":"Rae","email":"rae@example.test","password":"secret1","role":"admin"}',
      },
      {
        url: '/api/superadmin/portfolios/42/assignment',
        method: 'PUT',
        body: '{"relationship_manager_id":9}',
      },
      {
        url: '/api/superadmin/portfolios/42/assignment',
        method: 'DELETE',
        body: undefined,
      },
      { url: '/api/superadmin/audit-logs?page=2&limit=25', method: 'GET', body: undefined },
      { url: '/api/relationship-manager/portfolios/42', method: 'GET', body: undefined },
      {
        url: '/api/relationship-manager/conversations/7/investors/11',
        method: 'DELETE',
        body: undefined,
      },
    ],
  );
});

test('browser API exposes no obsolete admin staff or manual chat lifecycle methods', () => {
  const client = clientHarness();
  for (const method of [
    'getRelationshipManagers',
    'createRelationshipManager',
    'archiveManagedConversation',
    'reopenManagedConversation',
    'assignPortfolioRM',
    'getSuperAdminStats',
  ]) {
    assert.equal(client.run(`typeof API.${method}`), 'undefined', method);
  }
});

test('submitContact posts the exact public payload to the shared API', async () => {
  const client = clientHarness({ apiBase: 'https://hostile.example/api' });
  const requests = [];
  client.context.fetch = async (url, options) => {
    requests.push({ url, options });
    return response(201, { message: 'Message received' });
  };

  const result = await client.run(`
    API.submitContact({
      name: 'Visitor',
      email: 'visitor@example.com',
      message: 'Hello',
      company_website: '',
      role: 'superadmin',
      nested: { unsafe: true }
    })
  `);

  assert.equal(result.message, 'Message received');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    message: 'Message received',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/contact');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    name: 'Visitor',
    email: 'visitor@example.com',
    message: 'Hello',
    company_website: '',
  });
});

test('submitContact rejects a success body with unexpected fields', async () => {
  const client = clientHarness();
  client.context.fetch = async () => response(201, {
    message: 'Message received',
    email: 'visitor@example.com',
    id: 42,
  });

  await assert.rejects(
    client.run("API.submitContact({})"),
    /Contact service returned an invalid response\./,
  );
});

for (const status of [200, 204, 299]) {
  test(`submitContact rejects HTTP ${status} despite a success acknowledgement`, async () => {
    const client = clientHarness();
    client.context.fetch = async () => response(status, {
      message: 'Message received',
    });

    await assert.rejects(
      client.run("API.submitContact({})"),
      /Contact service returned an invalid response\./,
    );
  });
}

test('submitContact rejects malformed and non-JSON success responses safely', async () => {
  const client = clientHarness();
  const responses = [
    response(201, { message: '<script>unsafe response</script>' }),
    {
      ok: true,
      status: 201,
      json: async () => {
        throw new SyntaxError('private invalid response body');
      },
    },
  ];

  for (const nextResponse of responses) {
    client.context.nextResponse = nextResponse;
    client.context.fetch = async () => client.context.nextResponse;
    await assert.rejects(client.run(`
      API.submitContact({
        name: 'Visitor',
        email: 'visitor@example.com',
        message: '',
        company_website: ''
      })
    `), (error) => {
      assert.equal(error.message, 'Contact service returned an invalid response.');
      assert.doesNotMatch(error.message, /script|unsafe|private/i);
      return true;
    });
  }
});

test('submitContact retains only own allowlisted exact validation fields', async () => {
  const client = clientHarness();
  client.context.fetch = async () => response(400, {
    errors: JSON.parse(`{
      "email": "Enter a valid email address.",
      "name": "<unsafe name detail>",
      "unknown": "unsafe unknown detail",
      "constructor": "unsafe prototype detail",
      "__proto__": "unsafe prototype detail"
    }`),
  });

  await assert.rejects(client.run("API.submitContact({})"), (error) => {
    assert.equal(error.status, 400);
    assert.deepEqual(
      JSON.parse(JSON.stringify(error.fields)),
      { email: 'Enter a valid email address.' },
    );
    assert.doesNotMatch(JSON.stringify(error), /unsafe|unknown|prototype/i);
    return true;
  });
});

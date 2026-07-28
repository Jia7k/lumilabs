const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const {
  createContactRateLimiter,
  createContactRouter,
} = require('../src/routes/contact');
const {
  ContactSubmissionValidationError,
} = require('../src/services/contact-submission-workflow');

const validPayload = {
  name: 'Visitor',
  email: 'visitor@example.com',
  message: 'Hello',
  company_website: '',
};

function contactApp({ workflow }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/', createContactRouter({
    database: {},
    workflow,
    limiter: createContactRateLimiter(),
  }));
  app.use((error, req, res, next) => {
    assert.equal(error.message, 'Contact submission failed');
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function requestJson(app, payload, headers = {}, requestPath = '/') {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path: requestPath,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode,
          headers: response.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      });
      request.on('error', reject);
      request.end(JSON.stringify(payload));
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('valid input returns only the generic success response', async () => {
  const calls = [];
  const app = contactApp({
    workflow: async (payload) => { calls.push(payload); },
  });
  const response = await requestJson(app, {
    name: ' Visitor ',
    email: ' visitor@example.com ',
    message: ' Hello ',
    company_website: '',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { message: 'Message received' });
  assert.equal('id' in response.body, false);
  assert.equal(JSON.stringify(response.body).includes('visitor@example.com'), false);
  assert.equal(calls.length, 1);
});

test('honeypot input returns generic success without calling the workflow', async () => {
  let calls = 0;
  const app = contactApp({ workflow: async () => { calls += 1; } });
  const response = await requestJson(app, {
    name: 'Bot',
    email: 'bot@example.com',
    message: 'Spam',
    company_website: 'https://spam.example',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { message: 'Message received' });
  assert.equal(calls, 0);
});

test('sixth request from one address is limited with standard headers', async () => {
  const app = contactApp({ workflow: async () => {} });
  const responses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    responses.push(await requestJson(app, validPayload, {
      'x-forwarded-for': '203.0.113.10',
    }));
  }

  assert.deepEqual(responses.slice(0, 5).map(({ status }) => status), [201, 201, 201, 201, 201]);
  assert.equal(responses[5].status, 429);
  assert.deepEqual(responses[5].body, {
    error: 'Too many requests. Please try again later.',
  });
  assert.match(responses[5].headers['ratelimit-policy'], /5/);
  assert.equal(responses[5].headers['x-ratelimit-limit'], undefined);
});

test('validation errors become safe field-level 400 responses', async () => {
  const app = contactApp({
    workflow: async () => {
      throw new ContactSubmissionValidationError({
        email: 'Enter a valid email address.',
      });
    },
  });
  const response = await requestJson(app, {
    ...validPayload,
    email: 'invalid',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    errors: { email: 'Enter a valid email address.' },
  });
});

test('non-string honeypot is rejected before storage', async () => {
  let calls = 0;
  const app = contactApp({ workflow: async () => { calls += 1; } });
  const response = await requestJson(app, {
    ...validPayload,
    company_website: ['not', 'text'],
  });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    errors: { company_website: 'Invalid form submission.' },
  });
  assert.equal(calls, 0);
});

test('separate forwarded addresses have independent request budgets', async () => {
  const app = contactApp({ workflow: async () => {} });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(
      (await requestJson(app, validPayload, {
        'x-forwarded-for': '203.0.113.20',
      })).status,
      201,
    );
  }
  assert.equal(
    (await requestJson(app, validPayload, {
      'x-forwarded-for': '203.0.113.21',
    })).status,
    201,
  );
});

test('unexpected storage failure returns only the global safe 500', async () => {
  const app = contactApp({
    workflow: async () => {
      throw new Error('database rejected visitor@example.com');
    },
  });
  const response = await requestJson(app, validPayload);
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Internal server error' });
  assert.doesNotMatch(JSON.stringify(response.body), /Visitor|visitor@example\.com|Hello/);
});

test('unified server mounts the public Contact route at /api/contact', async () => {
  const { createApp } = require('../server');
  const inserts = [];
  const database = {
    async execute(sql, params) {
      inserts.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
    async query() {
      return [[], []];
    },
  };
  const app = createApp({
    database,
    verifySchema: async () => true,
    contactLimiter: (req, res, next) => next(),
  });
  const response = await requestJson(app, validPayload, {}, '/api/contact');

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { message: 'Message received' });
  assert.equal(inserts.length, 1);
});

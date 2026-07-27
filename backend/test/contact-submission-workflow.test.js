const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContactSubmissionValidationError,
  createContactSubmission,
  normalizeContactSubmission,
} = require('../src/services/contact-submission-workflow');

test('normalization trims strings and maps a blank optional message to null', () => {
  assert.deepEqual(
    normalizeContactSubmission({
      name: '  Ada Lovelace  ',
      email: '  Ada@Example.com  ',
      message: '   ',
    }),
    {
      name: 'Ada Lovelace',
      email: 'Ada@Example.com',
      message: null,
    },
  );
});

test('workflow performs one parameterized insert without echoing PII', async () => {
  const calls = [];
  const database = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  const result = await createContactSubmission({
    database,
    name: ' Visitor ',
    email: ' visitor@example.com ',
    message: ' Hello ',
  });

  assert.equal(result, undefined);
  assert.deepEqual(calls, [{
    sql: 'INSERT INTO contact_submissions (name, email, message) VALUES (?, ?, ?)',
    params: ['Visitor', 'visitor@example.com', 'Hello'],
  }]);
});

test('validation reports safe field errors at Unicode boundaries', () => {
  assert.throws(
    () => normalizeContactSubmission({
      name: '🙂'.repeat(101),
      email: 'not-an-email',
      message: '界'.repeat(5001),
    }),
    (error) => {
      assert.equal(error instanceof ContactSubmissionValidationError, true);
      assert.deepEqual(error.fields, {
        name: 'Name must be 100 characters or fewer.',
        email: 'Enter a valid email address.',
        message: 'Message must be 5,000 characters or fewer.',
      });
      assert.doesNotMatch(error.message, /not-an-email|🙂|界/);
      return true;
    },
  );
});

test('workflow rejects a non-insert result with a generic error', async () => {
  const database = { execute: async () => [{ affectedRows: 0 }] };
  await assert.rejects(
    createContactSubmission({
      database,
      name: 'Visitor',
      email: 'visitor@example.com',
      message: '',
    }),
    (error) => {
      assert.equal(error.message, 'Contact submission could not be stored');
      assert.doesNotMatch(error.message, /Visitor|visitor@example\.com/);
      return true;
    },
  );
});

test('normalization accepts the exact maximum Unicode lengths', () => {
  const email = `${'a'.repeat(250)}@e.co`;
  assert.equal([...email].length, 255);
  assert.doesNotThrow(() => normalizeContactSubmission({
    name: '🙂'.repeat(100),
    email,
    message: '界'.repeat(5000),
  }));
});

test('normalization rejects missing, oversized and non-string fields safely', () => {
  const valid = {
    name: 'Visitor',
    email: 'visitor@example.com',
    message: 'Hello',
  };
  const cases = [
    [{ ...valid, name: '' }, 'name', 'Enter your name.'],
    [{ ...valid, name: 'a'.repeat(101) }, 'name', 'Name must be 100 characters or fewer.'],
    [{ ...valid, name: null }, 'name', 'Enter your name.'],
    [{ ...valid, email: '' }, 'email', 'Enter your email address.'],
    [{ ...valid, email: `${'a'.repeat(251)}@e.co` }, 'email', 'Email must be 255 characters or fewer.'],
    [{ ...valid, email: {} }, 'email', 'Enter your email address.'],
    [{ ...valid, message: '界'.repeat(5001) }, 'message', 'Message must be 5,000 characters or fewer.'],
    [{ ...valid, message: null }, 'message', 'Message must be text.'],
  ];

  for (const [payload, field, expected] of cases) {
    assert.throws(
      () => normalizeContactSubmission(payload),
      (error) => {
        assert.equal(error.fields[field], expected);
        return true;
      },
    );
  }
});

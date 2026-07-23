const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CANONICAL_SECTORS,
  MVP_STATUSES,
  DB_LIMITS,
  hasMaxCharacters,
  hasMaxUtf8Bytes,
  isBoundedInteger,
  isBoundedDecimal,
  isAbsoluteHttpUrl,
  isValidDocumentFilename,
  normalizeReadinessScore,
} = require('../src/validation/database-boundaries');

test('exports the exact database-backed constants', () => {
  assert.deepEqual(CANONICAL_SECTORS, [
    'SaaS',
    'Fintech',
    'Healthtech',
    'Edtech',
    'AI / ML',
    'Clean Energy',
    'E-commerce',
    'Logistics',
    'Other',
  ]);
  assert.deepEqual(MVP_STATUSES, ['Idea', 'Prototype', 'Beta', 'Launched']);
  assert.deepEqual(DB_LIMITS, {
    USER_NAME_CHARS: 100,
    USER_EMAIL_CHARS: 255,
    PORTFOLIO_NAME_CHARS: 255,
    SECTOR_CHARS: 100,
    LOCATION_CHARS: 255,
    WEBSITE_CHARS: 500,
    MARKET_SIZE_CHARS: 500,
    ADVISOR_NAMES_CHARS: 500,
    TEXT_BYTES: 65535,
    DOCUMENT_NAME_CHARS: 255,
    SIGNED_INT_MAX: 2147483647,
    YEAR_MIN: 1901,
    YEAR_MAX: 2100,
    DECIMAL_15_2_MAX: '9999999999999.99',
    DECIMAL_5_2_MAX: '999.99',
    JSON_LIMIT: '256kb',
  });
  assert.equal(Object.isFrozen(CANONICAL_SECTORS), true);
  assert.equal(Object.isFrozen(MVP_STATUSES), true);
  assert.equal(Object.isFrozen(DB_LIMITS), true);
});

test('validates DECIMAL boundaries without rounding', () => {
  const decimal15 = (value) => isBoundedDecimal(value, {
    min: '0',
    max: DB_LIMITS.DECIMAL_15_2_MAX,
    scale: 2,
  });
  const decimal5 = (value) => isBoundedDecimal(value, {
    min: '0',
    max: DB_LIMITS.DECIMAL_5_2_MAX,
    scale: 2,
  });

  for (const value of [
    '0',
    0,
    '0.01',
    '9999999999999.99',
    '1e3',
    '1.2e2',
    '1e-2',
  ]) {
    assert.equal(decimal15(value), true, `${value} must fit DECIMAL(15,2)`);
  }
  for (const value of [
    '10000000000000.00',
    '0.001',
    '1e-3',
    '1e13',
    '-0.01',
  ]) {
    assert.equal(decimal15(value), false, `${value} must not fit DECIMAL(15,2)`);
  }
  assert.equal(decimal5('999.99'), true);
  assert.equal(decimal5('1000.00'), false);
});

test('validates integer and year boundaries exactly', () => {
  const signedInteger = (value) => isBoundedInteger(value, {
    min: 0,
    max: DB_LIMITS.SIGNED_INT_MAX,
  });
  const year = (value) => isBoundedInteger(value, {
    min: DB_LIMITS.YEAR_MIN,
    max: DB_LIMITS.YEAR_MAX,
  });

  assert.equal(signedInteger(2147483647), true);
  assert.equal(signedInteger('1e3'), true);
  assert.equal(signedInteger(2147483648), false);
  assert.equal(signedInteger(1.5), false);
  assert.equal(signedInteger('1e-1'), false);
  assert.equal(year(1901), true);
  assert.equal(year(2100), true);
  assert.equal(year(1900), false);
  assert.equal(year(2101), false);
});

test('numeric helpers reject coercible and non-finite non-values', () => {
  const values = [
    null,
    '',
    '   ',
    true,
    false,
    [],
    {},
    NaN,
    Infinity,
    -Infinity,
    '+',
    '-',
  ];
  for (const value of values) {
    assert.equal(
      isBoundedDecimal(value, { min: '0', max: '999.99', scale: 2 }),
      false,
      `${String(value)} must not be a bounded decimal`,
    );
    assert.equal(
      isBoundedInteger(value, { min: 0, max: 2147483647 }),
      false,
      `${String(value)} must not be a bounded integer`,
    );
  }
});

test('measures code points and UTF-8 bytes using database semantics', () => {
  assert.equal(hasMaxCharacters('😀'.repeat(255), 255), true);
  assert.equal(hasMaxCharacters('😀'.repeat(256), 255), false);
  assert.equal(hasMaxCharacters(null, 255), false);

  assert.equal(hasMaxUtf8Bytes('a'.repeat(65535), 65535), true);
  assert.equal(hasMaxUtf8Bytes('a'.repeat(65536), 65535), false);
  assert.equal(hasMaxUtf8Bytes('界'.repeat(21845), 65535), true);
  assert.equal(hasMaxUtf8Bytes(`${'界'.repeat(21845)}a`, 65535), false);
  assert.equal(hasMaxUtf8Bytes('😀'.repeat(16383), 65535), true);
  assert.equal(hasMaxUtf8Bytes('😀'.repeat(16384), 65535), false);
});

test('accepts only absolute HTTP and HTTPS URLs', () => {
  for (const value of [
    'https://lumilabs.example/path',
    'http://127.0.0.1:3100/a?b=1',
  ]) {
    assert.equal(isAbsoluteHttpUrl(value), true);
  }
  for (const value of [
    '/relative',
    'ftp://lumilabs.example/file',
    'lumilabs.example',
    'http://',
    '',
    null,
  ]) {
    assert.equal(isAbsoluteHttpUrl(value), false);
  }
});

test('limits complete document filenames by Unicode code point', () => {
  assert.equal(isValidDocumentFilename(`${'a'.repeat(251)}.pdf`), true);
  assert.equal(isValidDocumentFilename(`${'a'.repeat(252)}.pdf`), false);
  assert.equal(isValidDocumentFilename(`${'😀'.repeat(251)}.pdf`), true);
  assert.equal(isValidDocumentFilename(`${'😀'.repeat(252)}.pdf`), false);
  assert.equal(isValidDocumentFilename(''), false);
  assert.equal(isValidDocumentFilename(null), false);
});

test('normalizes nullable and malformed readiness scores into 0..100', () => {
  for (const value of [
    null,
    undefined,
    'not-a-score',
    -1,
    true,
    false,
    [88],
    {},
    '',
    '   ',
    NaN,
    Infinity,
  ]) {
    assert.equal(normalizeReadinessScore(value), 0);
  }
  assert.equal(normalizeReadinessScore(88), 88);
  assert.equal(normalizeReadinessScore('88'), 88);
  assert.equal(normalizeReadinessScore(101), 100);
});

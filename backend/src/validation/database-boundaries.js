const CANONICAL_SECTORS = Object.freeze([
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

const MVP_STATUSES = Object.freeze([
  'Idea',
  'Prototype',
  'Beta',
  'Launched',
]);

const DB_LIMITS = Object.freeze({
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

function hasMaxCharacters(value, max) {
  return typeof value === 'string' && Array.from(value).length <= max;
}

function hasMaxUtf8Bytes(value, max) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= max;
}

function parseExactDecimal(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const source = String(value).trim();
  if (!source) return null;
  const match = source.match(
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/,
  );
  if (!match) return null;

  const exponent = Number(match[5] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
  const fraction = match[3] ?? match[4] ?? '';
  let digits = `${match[2] ?? '0'}${fraction}`.replace(/^0+(?=\d)/, '');
  let scale = fraction.length - exponent;

  if (/^0+$/.test(digits)) return { integer: 0n, scale: 0 };
  while (scale > 0 && digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    scale -= 1;
  }
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }

  const sign = match[1] === '-' ? -1n : 1n;
  return {
    integer: sign * BigInt(digits),
    scale,
  };
}

function integerAtScale(parsed, scale) {
  if (!parsed || parsed.scale > scale) return null;
  return parsed.integer * (10n ** BigInt(scale - parsed.scale));
}

function isBoundedDecimal(value, { min, max, scale }) {
  if (!Number.isInteger(scale) || scale < 0) return false;
  const parsed = parseExactDecimal(value);
  const parsedMin = parseExactDecimal(min);
  const parsedMax = parseExactDecimal(max);
  const integer = integerAtScale(parsed, scale);
  const minimum = integerAtScale(parsedMin, scale);
  const maximum = integerAtScale(parsedMax, scale);
  return integer !== null
    && minimum !== null
    && maximum !== null
    && integer >= minimum
    && integer <= maximum;
}

function isBoundedInteger(value, { min, max }) {
  const parsed = parseExactDecimal(value);
  const parsedMin = parseExactDecimal(min);
  const parsedMax = parseExactDecimal(max);
  return parsed !== null
    && parsedMin !== null
    && parsedMax !== null
    && parsed.scale === 0
    && parsedMin.scale === 0
    && parsedMax.scale === 0
    && parsed.integer >= parsedMin.integer
    && parsed.integer <= parsedMax.integer;
}

function isAbsoluteHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isValidDocumentFilename(value) {
  return typeof value === 'string'
    && value.length > 0
    && hasMaxCharacters(value, DB_LIMITS.DOCUMENT_NAME_CHARS);
}

function normalizeReadinessScore(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  if (typeof value === 'string' && value.trim() === '') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

module.exports = {
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
};

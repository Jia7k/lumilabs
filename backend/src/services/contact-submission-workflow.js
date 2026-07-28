class ContactSubmissionValidationError extends Error {
  constructor(fields) {
    super('Invalid contact submission');
    this.name = 'ContactSubmissionValidationError';
    this.fields = fields;
  }
}

function characterCount(value) {
  return [...value].length;
}

function normalizeContactSubmission({ name, email, message } = {}) {
  const fields = {};
  const normalized = {};

  if (typeof name !== 'string' || !name.trim()) {
    fields.name = 'Enter your name.';
  } else if (characterCount(name.trim()) > 100) {
    fields.name = 'Name must be 100 characters or fewer.';
  } else {
    normalized.name = name.trim();
  }

  if (typeof email !== 'string' || !email.trim()) {
    fields.email = 'Enter your email address.';
  } else if (characterCount(email.trim()) > 255) {
    fields.email = 'Email must be 255 characters or fewer.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    fields.email = 'Enter a valid email address.';
  } else {
    normalized.email = email.trim();
  }

  if (message === undefined || (typeof message === 'string' && !message.trim())) {
    normalized.message = null;
  } else if (typeof message !== 'string') {
    fields.message = 'Message must be text.';
  } else if (characterCount(message.trim()) > 5000) {
    fields.message = 'Message must be 5,000 characters or fewer.';
  } else {
    normalized.message = message.trim();
  }

  if (Object.keys(fields).length) {
    throw new ContactSubmissionValidationError(fields);
  }
  return normalized;
}

async function createContactSubmission({ database, name, email, message }) {
  const normalized = normalizeContactSubmission({ name, email, message });
  let result;
  try {
    [result] = await database.execute(
      'INSERT INTO contact_submissions (name, email, message) VALUES (?, ?, ?)',
      [normalized.name, normalized.email, normalized.message],
    );
  } catch {
    throw new Error('Contact submission could not be stored');
  }
  if (Number(result?.affectedRows) !== 1) {
    throw new Error('Contact submission could not be stored');
  }
}

module.exports = {
  ContactSubmissionValidationError,
  createContactSubmission,
  normalizeContactSubmission,
};

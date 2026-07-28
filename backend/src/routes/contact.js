const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  ContactSubmissionValidationError,
  createContactSubmission,
} = require('../services/contact-submission-workflow');

const SUCCESS = { message: 'Message received' };

function createContactRateLimiter({
  windowMs = 15 * 60 * 1000,
  limit = 5,
} = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'Too many requests. Please try again later.',
    },
  });
}

function createContactRouter({
  database,
  workflow = createContactSubmission,
  limiter = createContactRateLimiter(),
} = {}) {
  if (!database) throw new TypeError('database is required');
  const router = express.Router();

  router.post('/', limiter, async (req, res, next) => {
    const honeypot = req.body?.company_website;
    if (honeypot !== undefined && typeof honeypot !== 'string') {
      return res.status(400).json({
        errors: { company_website: 'Invalid form submission.' },
      });
    }
    if (typeof honeypot === 'string' && honeypot.trim()) {
      return res.status(201).json(SUCCESS);
    }

    try {
      await workflow({
        database,
        name: req.body?.name,
        email: req.body?.email,
        message: req.body?.message,
      });
      return res.status(201).json(SUCCESS);
    } catch (error) {
      if (error instanceof ContactSubmissionValidationError) {
        return res.status(400).json({ errors: error.fields });
      }
      return next(new Error('Contact submission failed'));
    }
  });

  return router;
}

module.exports = {
  createContactRateLimiter,
  createContactRouter,
};

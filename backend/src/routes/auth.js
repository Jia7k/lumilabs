const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { DB_LIMITS } = require('../validation/database-boundaries');

const router = express.Router();

const emailValidation = () => (
  body('email')
    .isString().bail()
    .normalizeEmail()
    .isLength({ max: DB_LIMITS.USER_EMAIL_CHARS })
    .withMessage('Email must be at most 255 characters').bail()
    .isEmail()
);

const registrationValidation = [
  emailValidation(),
  body('password').isString().bail().isLength({ min: 6 }),
  body('name')
    .isString().bail()
    .trim()
    .notEmpty().bail()
    .isLength({ max: DB_LIMITS.USER_NAME_CHARS })
    .withMessage('Name must be at most 100 characters'),
  body('role').isIn(['business_owner', 'investor']),
];

const loginValidation = [
  emailValidation(),
  body('password').isString().bail().notEmpty(),
];

function safeValidationErrors(req) {
  return validationResult(req).array().map(({ type, msg, path, location }) => ({
    type,
    msg,
    path,
    location,
  }));
}

// POST /api/auth/register
router.post(
  '/register',
  registrationValidation,
  async (req, res) => {
    const errors = safeValidationErrors(req);
    if (errors.length) return res.status(400).json({ errors });

    const { email, password, name, role } = req.body;

    try {
      const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const password_hash = await bcrypt.hash(password, 10);
      const [result] = await db.query(
        'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)',
        [email, password_hash, name, role]
      );

      const token = jwt.sign(
        { id: result.insertId, email, name, role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.status(201).json({ token, user: { id: result.insertId, email, name, role } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// POST /api/auth/login
router.post(
  '/login',
  loginValidation,
  async (req, res) => {
    const errors = safeValidationErrors(req);
    if (errors.length) return res.status(400).json({ errors });

    const { email, password } = req.body;

    try {
      const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, email, name, role, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

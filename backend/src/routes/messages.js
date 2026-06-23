const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/messages/conversations  — list all conversations for current user
router.get('/conversations', authenticate, async (req, res) => {
  try {
    // Get latest message per conversation partner
    const [rows] = await db.query(
      `SELECT
        m.id, m.content, m.created_at, m.read_at,
        IF(m.sender_id = ?, m.receiver_id, m.sender_id) AS partner_id,
        u.name AS partner_name, u.role AS partner_role,
        p.id AS portfolio_id, p.name AS portfolio_name,
        (
          SELECT COUNT(*) FROM messages
          WHERE receiver_id = ? AND sender_id = IF(m.sender_id = ?, m.receiver_id, m.sender_id) AND read_at IS NULL
        ) AS unread_count
       FROM messages m
       JOIN users u ON u.id = IF(m.sender_id = ?, m.receiver_id, m.sender_id)
       LEFT JOIN portfolios p ON p.id = m.portfolio_id
       WHERE m.sender_id = ? OR m.receiver_id = ?
       GROUP BY partner_id
       ORDER BY m.created_at DESC`,
      [
        req.user.id, req.user.id, req.user.id,
        req.user.id,
        req.user.id, req.user.id,
      ]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/messages/conversations/:partnerId  — get full thread with a user
router.get('/conversations/:partnerId', authenticate, async (req, res) => {
  const partnerId = parseInt(req.params.partnerId, 10);

  try {
    const [messages] = await db.query(
      `SELECT m.*, u.name AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE (m.sender_id = ? AND m.receiver_id = ?)
          OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at ASC`,
      [req.user.id, partnerId, partnerId, req.user.id]
    );

    // Mark incoming messages as read
    await db.query(
      'UPDATE messages SET read_at = NOW() WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL',
      [partnerId, req.user.id]
    );

    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/messages  — send a message
router.post(
  '/',
  authenticate,
  [
    body('receiver_id').isInt(),
    body('content').trim().notEmpty(),
    body('portfolio_id').optional().isInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { receiver_id, content, portfolio_id = null } = req.body;

    if (receiver_id === req.user.id) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    try {
      const [receiver] = await db.query('SELECT id, name FROM users WHERE id = ?', [receiver_id]);
      if (receiver.length === 0) return res.status(404).json({ error: 'Receiver not found' });

      const [result] = await db.query(
        'INSERT INTO messages (sender_id, receiver_id, portfolio_id, content) VALUES (?, ?, ?, ?)',
        [req.user.id, receiver_id, portfolio_id, content]
      );

      // Notify receiver
      let portfolioName = null;
      if (portfolio_id) {
        const [p] = await db.query('SELECT name FROM portfolios WHERE id = ?', [portfolio_id]);
        if (p.length > 0) portfolioName = p[0].name;
      }

      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, related_portfolio_id, related_user_id)
         VALUES (?, 'new_message', 'New Message', ?, ?, ?)`,
        [
          receiver_id,
          portfolioName
            ? `${req.user.name} sent you a message about "${portfolioName}"`
            : `${req.user.name} sent you a message`,
          portfolio_id,
          req.user.id,
        ]
      );

      const [msg] = await db.query('SELECT * FROM messages WHERE id = ?', [result.insertId]);
      res.status(201).json(msg[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;

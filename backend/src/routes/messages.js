const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/messages/me — current authenticated message user
router.get('/me', authenticate, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role,
  });
});

// GET /api/messages/conversations  — list all conversations for current user
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const userId = Number(req.user.id);

    const [rows] = await db.query(
      `SELECT
        m.id, m.sender_id, m.receiver_id, m.content, m.created_at, m.read_at,
        latest.partner_id,
        COALESCE(u.name, CONCAT('User ', latest.partner_id)) AS partner_name,
        COALESCE(u.role, '') AS partner_role,
        p.id AS portfolio_id, p.name AS portfolio_name,
        COALESCE(unread.unread_count, 0) AS unread_count
       FROM (
        SELECT
          IF(sender_id = ?, receiver_id, sender_id) AS partner_id,
          MAX(id) AS latest_message_id
        FROM messages
        WHERE sender_id = ? OR receiver_id = ?
        GROUP BY partner_id
       ) latest
       JOIN messages m ON m.id = latest.latest_message_id
       LEFT JOIN users u ON u.id = latest.partner_id
       LEFT JOIN portfolios p ON p.id = m.portfolio_id
       LEFT JOIN (
        SELECT sender_id AS partner_id, COUNT(*) AS unread_count
        FROM messages
        WHERE receiver_id = ? AND read_at IS NULL
        GROUP BY sender_id
       ) unread ON unread.partner_id = latest.partner_id
       ORDER BY m.created_at DESC, m.id DESC`,
      [userId, userId, userId, userId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/messages/conversations/:partnerId  — get full thread with a user
router.get('/conversations/:partnerId', authenticate, async (req, res) => {
  const userId = Number(req.user.id);
  const partnerId = parseInt(req.params.partnerId, 10);

  if (!Number.isInteger(userId) || !Number.isInteger(partnerId) || partnerId <= 0) {
    return res.status(400).json({ error: 'Invalid conversation partner' });
  }

  try {
    const [messages] = await db.query(
      `SELECT
        m.*,
        COALESCE(u.name, CONCAT('User ', m.sender_id)) AS sender_name,
        p.name AS portfolio_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN portfolios p ON p.id = m.portfolio_id
       WHERE (m.sender_id = ? AND m.receiver_id = ?)
          OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at ASC`,
      [userId, partnerId, partnerId, userId]
    );

    // Mark incoming messages as read
    await db.query(
      'UPDATE messages SET read_at = NOW() WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL',
      [partnerId, userId]
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
    body('receiver_id').isInt({ min: 1 }).toInt(),
    body('content').trim().notEmpty().isLength({ max: 2000 }),
    body('portfolio_id').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const senderId = Number(req.user.id);
    const { receiver_id, content } = req.body;
    const portfolio_id = req.body.portfolio_id || null;

    if (receiver_id === senderId) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    let connection;
    let transactionOpen = false;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;

      const [receiver] = await connection.query(
        'SELECT id, name FROM users WHERE id = ?',
        [receiver_id]
      );
      if (receiver.length === 0) {
        await connection.rollback();
        transactionOpen = false;
        return res.status(404).json({ error: 'Receiver not found' });
      }

      let portfolioName = null;
      if (portfolio_id) {
        const [portfolioRows] = await connection.query(
          'SELECT id, name, owner_id FROM portfolios WHERE id = ?',
          [portfolio_id]
        );

        if (portfolioRows.length === 0) {
          await connection.rollback();
          transactionOpen = false;
          return res.status(404).json({ error: 'Portfolio not found' });
        }

        const portfolio = portfolioRows[0];
        const canDiscussPortfolio =
          Number(portfolio.owner_id) === senderId
          || Number(portfolio.owner_id) === receiver_id;

        if (!canDiscussPortfolio) {
          await connection.rollback();
          transactionOpen = false;
          return res.status(403).json({ error: 'Portfolio is not related to this conversation' });
        }

        portfolioName = portfolio.name;
      }

      const [result] = await connection.query(
        'INSERT INTO messages (sender_id, receiver_id, portfolio_id, content) VALUES (?, ?, ?, ?)',
        [senderId, receiver_id, portfolio_id, content]
      );

      // Notify receiver as part of the same transaction as the message.
      await connection.query(
        `INSERT INTO notifications (user_id, type, title, body, related_portfolio_id, related_user_id)
         VALUES (?, 'new_message', 'New Message', ?, ?, ?)`,
        [
          receiver_id,
          portfolioName
            ? `${req.user.name} sent you a message about "${portfolioName}"`
            : `${req.user.name} sent you a message`,
          portfolio_id,
          senderId,
        ]
      );

      const [messages] = await connection.query(
        'SELECT * FROM messages WHERE id = ?',
        [result.insertId]
      );
      if (messages.length !== 1) {
        throw new Error('Inserted message could not be read back');
      }

      await connection.commit();
      transactionOpen = false;
      return res.status(201).json(messages[0]);
    } catch (err) {
      if (connection && transactionOpen) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Message transaction rollback failed', rollbackError);
        }
      }

      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    } finally {
      if (connection) {
        try {
          connection.release();
        } catch (releaseError) {
          console.error('Message connection release failed', releaseError);
        }
      }
    }
  }
);

module.exports = router;

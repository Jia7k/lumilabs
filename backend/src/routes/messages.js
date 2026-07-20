const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const router = express.Router();

const prototypeUsers = {
  alpha: { id: 2, name: 'Alpha', role: 'investor' },
  beta: { id: 3, name: 'Beta', role: 'business_owner' },
  victor: { name: 'Victor', role: 'admin' },
};

async function resolveMessageUser(req, res, next) {
  const selectedKey = String(req.get('X-LumiLabs-Prototype-User') || '').toLowerCase();
  const selectedRole = String(req.get('X-LumiLabs-Prototype-Role') || '').toLowerCase();
  const selectedName = String(req.get('X-LumiLabs-Prototype-Name') || '').trim();
  const prototypeUser = prototypeUsers[selectedKey] || (
    selectedName && selectedRole ? { name: selectedName, role: selectedRole } : null
  );

  if (prototypeUser) {
    try {
      if (prototypeUser.id) {
        const [rows] = await db.query(
          'SELECT id, email, name, role FROM users WHERE id = ? LIMIT 1',
          [prototypeUser.id]
        );

        if (rows.length === 0) {
          return res.status(404).json({
            error: `Prototype user ${prototypeUser.name} must exist as user id ${prototypeUser.id}`,
          });
        }

        req.user = {
          ...rows[0],
          name: prototypeUser.name,
          role: prototypeUser.role,
        };
        return next();
      }

      const [rows] = await db.query(
        'SELECT id, email, name, role FROM users WHERE name = ? AND role = ? ORDER BY id LIMIT 1',
        [prototypeUser.name, prototypeUser.role]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: `Prototype user ${prototypeUser.name} (${prototypeUser.role}) was not found in the database`,
        });
      }

      req.user = rows[0];
      return next();
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  return res.status(401).json({ error: 'Select a role before opening messages' });
}

// GET /api/messages/me — current message user for the prototype flow
router.get('/me', resolveMessageUser, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role,
  });
});

// GET /api/messages/conversations  — list all conversations for current user
router.get('/conversations', resolveMessageUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);

    const [rows] = await db.query(
      `SELECT
        m.id, m.sender_id, m.receiver_id, m.content, m.created_at, m.read_at,
        latest.partner_id,
        CASE latest.partner_id
          WHEN 2 THEN 'Alpha'
          WHEN 3 THEN 'Beta'
          ELSE COALESCE(u.name, CONCAT('User ', latest.partner_id))
        END AS partner_name,
        CASE latest.partner_id
          WHEN 2 THEN 'investor'
          WHEN 3 THEN 'business_owner'
          ELSE COALESCE(u.role, '')
        END AS partner_role,
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
router.get('/conversations/:partnerId', resolveMessageUser, async (req, res) => {
  const userId = Number(req.user.id);
  const partnerId = parseInt(req.params.partnerId, 10);

  if (!Number.isInteger(userId) || !Number.isInteger(partnerId) || partnerId <= 0) {
    return res.status(400).json({ error: 'Invalid conversation partner' });
  }

  try {
    const [messages] = await db.query(
      `SELECT
        m.*,
        CASE m.sender_id
          WHEN 2 THEN 'Alpha'
          WHEN 3 THEN 'Beta'
          ELSE COALESCE(u.name, CONCAT('User ', m.sender_id))
        END AS sender_name,
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
  resolveMessageUser,
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

const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/admin/queue  — pending portfolios
router.get('/queue', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, u.name AS owner_name, u.email AS owner_email,
        (SELECT COUNT(*) FROM portfolio_documents WHERE portfolio_id = p.id) AS doc_count
       FROM portfolios p
       JOIN users u ON u.id = p.owner_id
       WHERE p.status = 'pending'
       ORDER BY p.submitted_at ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/portfolios/:id/approve
router.put('/portfolios/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM portfolios WHERE id = ? AND status = 'pending'",
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Pending portfolio not found' });
    }

    await db.query(
      "UPDATE portfolios SET status='approved', rejection_reason=NULL WHERE id=?",
      [req.params.id]
    );

    await db.query(
      `INSERT INTO audit_logs (admin_id, action, portfolio_id, notes) VALUES (?, 'approved', ?, ?)`,
      [req.user.id, req.params.id, req.body.notes || null]
    );

    // Notify business owner
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, related_portfolio_id, related_user_id)
       VALUES (?, 'portfolio_approved', 'Portfolio Approved!', ?, ?, ?)`,
      [
        rows[0].owner_id,
        `Your portfolio "${rows[0].name}" has been approved and is now visible to investors`,
        req.params.id,
        req.user.id,
      ]
    );

    res.json({ message: 'Portfolio approved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/admin/portfolios/:id/reject
router.put(
  '/portfolios/:id/reject',
  authenticate,
  requireRole('admin'),
  [body('reason').trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const [rows] = await db.query(
        "SELECT * FROM portfolios WHERE id = ? AND status = 'pending'",
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Pending portfolio not found' });
      }

      await db.query(
        "UPDATE portfolios SET status='rejected', rejection_reason=? WHERE id=?",
        [req.body.reason, req.params.id]
      );

      await db.query(
        `INSERT INTO audit_logs (admin_id, action, portfolio_id, notes) VALUES (?, 'rejected', ?, ?)`,
        [req.user.id, req.params.id, req.body.reason]
      );

      // Notify business owner
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, related_portfolio_id, related_user_id)
         VALUES (?, 'portfolio_rejected', 'Portfolio Rejected', ?, ?, ?)`,
        [
          rows[0].owner_id,
          `Your portfolio "${rows[0].name}" was rejected: ${req.body.reason}`,
          req.params.id,
          req.user.id,
        ]
      );

      res.json({ message: 'Portfolio rejected' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// PUT /api/admin/portfolios/:id/request-changes
router.put(
  '/portfolios/:id/request-changes',
  authenticate,
  requireRole('admin'),
  [body('reason').trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const [rows] = await db.query(
        "SELECT * FROM portfolios WHERE id = ? AND status = 'pending'",
        [req.params.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Pending portfolio not found' });
      }

      // Revert to draft so owner can edit and resubmit
      await db.query(
        "UPDATE portfolios SET status='draft', rejection_reason=? WHERE id=?",
        [req.body.reason, req.params.id]
      );

      await db.query(
        `INSERT INTO audit_logs (admin_id, action, portfolio_id, notes) VALUES (?, 'requested_changes', ?, ?)`,
        [req.user.id, req.params.id, req.body.reason]
      );

      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, related_portfolio_id, related_user_id)
         VALUES (?, 'portfolio_needs_changes', 'Portfolio Needs Changes', ?, ?, ?)`,
        [
          rows[0].owner_id,
          `Your portfolio "${rows[0].name}" requires changes: ${req.body.reason}`,
          req.params.id,
          req.user.id,
        ]
      );

      res.json({ message: 'Changes requested' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// GET /api/admin/audit-logs
router.get('/audit-logs', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT al.*, u.name AS admin_name, p.name AS portfolio_name, o.name AS owner_name
       FROM audit_logs al
       JOIN users u ON u.id = al.admin_id
       JOIN portfolios p ON p.id = al.portfolio_id
       JOIN users o ON o.id = p.owner_id
       ORDER BY al.created_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/stats
router.get('/stats', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const [[{ pending }]] = await db.query("SELECT COUNT(*) AS pending FROM portfolios WHERE status='pending'");
    const [[{ approved }]] = await db.query("SELECT COUNT(*) AS approved FROM portfolios WHERE status='approved'");
    const [[{ rejected }]] = await db.query("SELECT COUNT(*) AS rejected FROM portfolios WHERE status='rejected'");
    const [[{ total_matches }]] = await db.query('SELECT COUNT(*) AS total_matches FROM investor_interests');
    const [[{ total_users }]] = await db.query('SELECT COUNT(*) AS total_users FROM users');

    res.json({ pending, approved, rejected, total_matches, total_users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/users  — list all users
router.get('/users', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

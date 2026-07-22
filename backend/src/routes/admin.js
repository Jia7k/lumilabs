const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { moderatePortfolio } = require('../services/workflow');

const router = express.Router();

function sendWorkflowError(res, error) {
  if (error && Number.isInteger(error.status)) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: 'Server error' });
}

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
    const result = await moderatePortfolio({
      portfolioId: req.params.id,
      adminId: req.user.id,
      action: 'approved',
      reason: null,
    });
    res.json(result);
  } catch (err) {
    sendWorkflowError(res, err);
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
      const result = await moderatePortfolio({
        portfolioId: req.params.id,
        adminId: req.user.id,
        action: 'rejected',
        reason: req.body.reason,
      });
      res.json(result);
    } catch (err) {
      sendWorkflowError(res, err);
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

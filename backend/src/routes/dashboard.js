const express = require('express');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/business-owner
router.get('/business-owner', authenticate, requireRole('business_owner'), async (req, res) => {
  try {
    const userId = req.user.id;

    const [[portfolioStats]] = await db.query(
      `SELECT
        COUNT(*) AS total,
        SUM(status = 'approved') AS approved,
        SUM(status = 'pending') AS pending,
        SUM(status = 'draft') AS draft,
        ROUND(AVG(readiness_score), 0) AS avg_readiness
       FROM portfolios WHERE owner_id = ?`,
      [userId]
    );

    const [[interestStats]] = await db.query(
      `SELECT COUNT(*) AS total FROM investor_interests ii
       JOIN portfolios p ON p.id = ii.portfolio_id WHERE p.owner_id = ?`,
      [userId]
    );

    const [[msgStats]] = await db.query(
      `SELECT
        COUNT(*) AS total,
        SUM(read_at IS NULL) AS unread
       FROM messages WHERE receiver_id = ?`,
      [userId]
    );

    const [recentPortfolios] = await db.query(
      `SELECT id, name, sector, status, readiness_score FROM portfolios
       WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 5`,
      [userId]
    );

    const [recentInterests] = await db.query(
      `SELECT u.name AS investor, u.id AS investor_id, p.id AS portfolio_id, p.name AS portfolio
       FROM investor_interests ii
       JOIN users u ON u.id = ii.investor_id
       JOIN portfolios p ON p.id = ii.portfolio_id
       WHERE p.owner_id = ? ORDER BY ii.created_at DESC LIMIT 5`,
      [userId]
    );

    const [notifications] = await db.query(
      `SELECT id, type, title, body, read_at, created_at FROM notifications
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      [userId]
    );

    res.json({
      user: { name: req.user.name, role: req.user.role },
      portfolios: {
        total: portfolioStats.total || 0,
        approved: portfolioStats.approved || 0,
        pending: portfolioStats.pending || 0,
        draft: portfolioStats.draft || 0,
      },
      investorInterests: interestStats.total || 0,
      messages: {
        total: msgStats.total || 0,
        unread: msgStats.unread || 0,
      },
      avgReadiness: portfolioStats.avg_readiness || 0,
      recentPortfolios,
      recentInterests,
      notifications,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/dashboard/investor
router.get('/investor', authenticate, requireRole('investor'), async (req, res) => {
  try {
    const userId = req.user.id;

    const [[{ available }]] = await db.query(
      "SELECT COUNT(*) AS available FROM portfolios WHERE status = 'approved'"
    );

    const [[{ my_interests }]] = await db.query(
      'SELECT COUNT(*) AS my_interests FROM investor_interests WHERE investor_id = ?',
      [userId]
    );

    const [[msgStats]] = await db.query(
      `SELECT COUNT(*) AS total FROM messages WHERE sender_id = ? OR receiver_id = ?`,
      [userId, userId]
    );

    const [[{ high_potential }]] = await db.query(
      "SELECT COUNT(*) AS high_potential FROM portfolios WHERE status = 'approved' AND readiness_score >= 75"
    );

    const [recentInterests] = await db.query(
      `SELECT p.id, p.name, p.sector FROM investor_interests ii
       JOIN portfolios p ON p.id = ii.portfolio_id
       WHERE ii.investor_id = ? ORDER BY ii.created_at DESC LIMIT 5`,
      [userId]
    );

    const [notifications] = await db.query(
      `SELECT id, type, title, body, read_at, created_at FROM notifications
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      [userId]
    );

    res.json({
      user: { name: req.user.name, role: req.user.role },
      stats: {
        available,
        interests: my_interests,
        messages: msgStats.total,
        highPotential: high_potential,
      },
      recentInterests,
      notifications,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/dashboard/admin
router.get('/admin', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const [[{ pending }]] = await db.query("SELECT COUNT(*) AS pending FROM portfolios WHERE status = 'pending'");
    const [[{ approved }]] = await db.query("SELECT COUNT(*) AS approved FROM portfolios WHERE status = 'approved'");
    const [[{ rejected }]] = await db.query("SELECT COUNT(*) AS rejected FROM portfolios WHERE status = 'rejected'");
    const [[{ total_matches }]] = await db.query('SELECT COUNT(*) AS total_matches FROM investor_interests');

    const [queue] = await db.query(
      `SELECT p.id, p.name, p.sector, p.readiness_score, p.submitted_at, u.name AS owner_name
       FROM portfolios p
       JOIN users u ON u.id = p.owner_id
       WHERE p.status = 'pending'
       ORDER BY p.submitted_at ASC
       LIMIT 10`
    );

    const [recentLogs] = await db.query(
      `SELECT al.action, al.created_at, al.reason, u.name AS admin_name, p.name AS portfolio_name
       FROM audit_logs al
       JOIN users u ON u.id = al.admin_id
       JOIN portfolios p ON p.id = al.portfolio_id
       ORDER BY al.created_at DESC LIMIT 5`
    );

    res.json({
      user: { name: req.user.name, role: req.user.role },
      stats: { pending, approved, rejected, totalMatches: total_matches },
      queue,
      recentLogs,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

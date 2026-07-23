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
        SUM(status = 'rejected') AS rejected,
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
        COUNT(m.id) AS total,
        COALESCE(SUM(
          m.id > GREATEST(cm.visible_after_message_id, cm.last_read_message_id)
          AND m.sender_id <> cm.user_id
        ), 0) AS unread
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       LEFT JOIN messages m
         ON m.conversation_id = cm.conversation_id
        AND m.id > cm.visible_after_message_id
       WHERE cm.user_id = ? AND cm.membership_status = 'active'`,
      [userId]
    );

    const [recentPortfolios] = await db.query(
      `SELECT id, name, sector, status, readiness_score FROM portfolios
       WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 5`,
      [userId]
    );

    const [recentInterests] = await db.query(
      `SELECT u.name AS investor, u.id AS investor_id,
              p.id AS portfolio_id, p.name AS portfolio,
              CASE WHEN owner_member.user_id IS NULL THEN NULL ELSE c.id END AS conversation_id,
              CASE WHEN owner_member.user_id IS NULL THEN NULL ELSE c.status END AS conversation_status,
              CASE
                WHEN owner_member.user_id IS NULL THEN 'awaiting_manager'
                WHEN c.status = 'active' THEN 'open'
                ELSE 'archived'
              END AS chat_state
       FROM investor_interests ii
       JOIN users u ON u.id = ii.investor_id
       JOIN portfolios p ON p.id = ii.portfolio_id
       LEFT JOIN conversations c ON c.portfolio_id = p.id
       LEFT JOIN conversation_members owner_member
         ON owner_member.conversation_id = c.id
        AND owner_member.user_id = p.owner_id
        AND owner_member.member_role = 'business_owner'
        AND owner_member.membership_status = 'active'
       WHERE p.owner_id = ? ORDER BY ii.created_at DESC LIMIT 5`,
      [userId]
    );

    const [notifications] = await db.query(
      `SELECT n.id, n.type, n.title, n.body, n.read_at, n.created_at
       FROM notifications n
       WHERE n.user_id = ?
         AND (
           n.related_conversation_id IS NULL
           OR EXISTS (
             SELECT 1 FROM conversation_members cm
             WHERE cm.conversation_id = n.related_conversation_id
               AND cm.user_id = n.user_id
               AND cm.membership_status = 'active'
           )
         )
       ORDER BY n.created_at DESC LIMIT 5`,
      [userId]
    );

    res.json({
      user: { name: req.user.name, role: req.user.role },
      portfolios: {
        total: portfolioStats.total || 0,
        approved: portfolioStats.approved || 0,
        pending: portfolioStats.pending || 0,
        rejected: portfolioStats.rejected || 0,
        draft: portfolioStats.draft || 0,
      },
      investorInterests: interestStats.total || 0,
      messages: {
        total: Number(msgStats.total || 0),
        unread: Number(msgStats.unread || 0),
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
      `SELECT
         COUNT(m.id) AS total,
         COALESCE(SUM(
           m.id > GREATEST(cm.visible_after_message_id, cm.last_read_message_id)
           AND m.sender_id <> cm.user_id
         ), 0) AS unread
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       LEFT JOIN messages m
         ON m.conversation_id = cm.conversation_id
        AND m.id > cm.visible_after_message_id
       WHERE cm.user_id = ? AND cm.membership_status = 'active'`,
      [userId]
    );

    const [[{ high_potential }]] = await db.query(
      "SELECT COUNT(*) AS high_potential FROM portfolios WHERE status = 'approved' AND readiness_score >= 75"
    );

    const [recentInterests] = await db.query(
      `SELECT p.id, p.name, p.sector,
              CASE WHEN cm.user_id IS NULL THEN NULL ELSE c.id END AS conversation_id,
              CASE WHEN cm.user_id IS NULL THEN NULL ELSE c.status END AS conversation_status,
              CASE
                WHEN cm.user_id IS NULL THEN 'awaiting_manager'
                WHEN c.status = 'active' THEN 'open'
                ELSE 'archived'
              END AS chat_state
       FROM investor_interests ii
       JOIN portfolios p ON p.id = ii.portfolio_id
       LEFT JOIN conversations c ON c.portfolio_id = p.id
       LEFT JOIN conversation_members cm
         ON cm.conversation_id = c.id
        AND cm.user_id = ii.investor_id
        AND cm.member_role = 'investor'
        AND cm.membership_status = 'active'
       WHERE ii.investor_id = ? ORDER BY ii.created_at DESC LIMIT 5`,
      [userId]
    );

    const [notifications] = await db.query(
      `SELECT n.id, n.type, n.title, n.body, n.read_at, n.created_at
       FROM notifications n
       WHERE n.user_id = ?
         AND (
           n.related_conversation_id IS NULL
           OR EXISTS (
             SELECT 1 FROM conversation_members cm
             WHERE cm.conversation_id = n.related_conversation_id
               AND cm.user_id = n.user_id
               AND cm.membership_status = 'active'
           )
         )
       ORDER BY n.created_at DESC LIMIT 5`,
      [userId]
    );

    res.json({
      user: { name: req.user.name, role: req.user.role },
      stats: {
        available,
        interests: my_interests,
        messages: Number(msgStats.total || 0),
        unreadMessages: Number(msgStats.unread || 0),
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

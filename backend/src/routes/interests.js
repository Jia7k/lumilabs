const express = require('express');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/interests/:portfolioId  — investor expresses interest
router.post('/:portfolioId', authenticate, requireRole('investor'), async (req, res) => {
  const portfolioId = req.params.portfolioId;

  try {
    const [portfolio] = await db.query(
      "SELECT * FROM portfolios WHERE id = ? AND status = 'approved'",
      [portfolioId]
    );
    if (portfolio.length === 0) {
      return res.status(404).json({ error: 'Approved portfolio not found' });
    }

    await db.query(
      'INSERT IGNORE INTO investor_interests (investor_id, portfolio_id) VALUES (?, ?)',
      [req.user.id, portfolioId]
    );

    // Notify the business owner
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, related_portfolio_id, related_user_id)
       VALUES (?, 'new_interest', 'New Investor Interest!', ?, ?, ?)`,
      [
        portfolio[0].owner_id,
        `${req.user.name} is interested in "${portfolio[0].name}"`,
        portfolioId,
        req.user.id,
      ]
    );

    res.status(201).json({ message: 'Interest expressed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/interests/:portfolioId  — investor removes interest
router.delete('/:portfolioId', authenticate, requireRole('investor'), async (req, res) => {
  try {
    await db.query(
      'DELETE FROM investor_interests WHERE investor_id = ? AND portfolio_id = ?',
      [req.user.id, req.params.portfolioId]
    );
    res.json({ message: 'Interest removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/interests/my  — investor: portfolios I'm interested in
router.get('/my', authenticate, requireRole('investor'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.owner_id, p.name, p.sector, p.readiness_score, p.funding_goal, u.name AS owner_name, ii.created_at AS interested_at
       FROM investor_interests ii
       JOIN portfolios p ON p.id = ii.portfolio_id
       JOIN users u ON u.id = p.owner_id
       WHERE ii.investor_id = ?
       ORDER BY ii.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/interests/received  — business owner: who is interested in my portfolios
router.get('/received', authenticate, requireRole('business_owner'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ii.id, ii.created_at, u.id AS investor_id, u.name AS investor_name, u.email AS investor_email,
        p.id AS portfolio_id, p.name AS portfolio_name
       FROM investor_interests ii
       JOIN users u ON u.id = ii.investor_id
       JOIN portfolios p ON p.id = ii.portfolio_id
       WHERE p.owner_id = ?
       ORDER BY ii.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

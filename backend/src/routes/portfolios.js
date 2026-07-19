const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Recalculate readiness score based on portfolio completeness
function calcReadinessScore(portfolio, docCount) {
  let score = 0;
  if (portfolio.name) score += 15;
  if (portfolio.sector) score += 15;
  if (portfolio.description && portfolio.description.length > 50) score += 20;
  if (portfolio.funding_goal > 0) score += 10;
  if (docCount >= 1) score += 20;
  if (docCount >= 3) score += 20;
  return Math.min(score, 100);
}

// GET /api/portfolios/my  — business owner's own portfolios
router.get('/my', authenticate, requireRole('business_owner'), async (req, res) => {
  try {
    const [portfolios] = await db.query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM portfolio_documents WHERE portfolio_id = p.id) AS doc_count,
        (SELECT COUNT(*) FROM investor_interests WHERE portfolio_id = p.id) AS interest_count
       FROM portfolios p WHERE p.owner_id = ? ORDER BY p.updated_at DESC`,
      [req.user.id]
    );
    res.json(portfolios);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/portfolios  — approved portfolios (investors can browse)
router.get('/', authenticate, requireRole('investor', 'admin'), async (req, res) => {
  try {
    const { sector, minScore } = req.query;
    let query = `
      SELECT p.id, p.owner_id, p.name, p.sector, p.description, p.funding_goal, p.readiness_score, p.created_at,
        u.name AS owner_name,
        (SELECT COUNT(*) FROM investor_interests WHERE portfolio_id = p.id) AS interest_count
      FROM portfolios p
      JOIN users u ON u.id = p.owner_id
      WHERE p.status = 'approved'
    `;
    const params = [];

    if (sector) {
      query += ' AND p.sector = ?';
      params.push(sector);
    }
    if (minScore) {
      query += ' AND p.readiness_score >= ?';
      params.push(parseInt(minScore, 10));
    }

    query += ' ORDER BY p.readiness_score DESC, p.created_at DESC';

    const [portfolios] = await db.query(query, params);
    res.json(portfolios);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/portfolios/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, u.name AS owner_name, u.email AS owner_email,
        (SELECT COUNT(*) FROM portfolio_documents WHERE portfolio_id = p.id) AS doc_count,
        (SELECT COUNT(*) FROM investor_interests WHERE portfolio_id = p.id) AS interest_count
       FROM portfolios p
       JOIN users u ON u.id = p.owner_id
       WHERE p.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Portfolio not found' });

    const portfolio = rows[0];

    // Business owners can only see their own; investors see only approved
    if (req.user.role === 'business_owner' && portfolio.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (req.user.role === 'investor' && portfolio.status !== 'approved') {
      return res.status(403).json({ error: 'Portfolio not available' });
    }

    const [docs] = await db.query(
      'SELECT * FROM portfolio_documents WHERE portfolio_id = ? ORDER BY uploaded_at DESC',
      [req.params.id]
    );

    res.json({ ...portfolio, documents: docs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/portfolios  — create a new portfolio (business owners)
router.post(
  '/',
  authenticate,
  requireRole('business_owner'),
  [
    body('name').trim().notEmpty(),
    body('sector').trim().notEmpty(),
    body('mvp_status').isIn(['Idea', 'Prototype', 'Beta', 'Launched']),
    body('description').optional().trim(),
    body('funding_goal').optional().isFloat({ min: 0 }),
    body('team_size').optional().isInt({ min: 0 }),
    body('founded_year').optional().isInt({ min: 1900, max: 2100 }),
    body('location').optional().trim(),
    body('website').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      name,
      sector,
      mvp_status,
      description = '',
      funding_goal = 0,
      team_size = null,
      founded_year = null,
      location = null,
      website = null,
    } = req.body;
    const readiness_score = calcReadinessScore({ name, sector, description, funding_goal }, 0);

    try {
      const [result] = await db.query(
        `INSERT INTO portfolios
          (owner_id, name, sector, mvp_status, description, funding_goal, team_size, founded_year, location, website, readiness_score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id, name, sector, mvp_status, description, funding_goal,
          team_size, founded_year, location, website, readiness_score, 'draft',
        ]
      );
      const [rows] = await db.query('SELECT * FROM portfolios WHERE id = ?', [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// PUT /api/portfolios/:id  — update portfolio (draft, rejected, or approved)
router.put(
  '/:id',
  authenticate,
  requireRole('business_owner'),
  [
    body('name').optional().trim().notEmpty(),
    body('sector').optional().trim().notEmpty(),
    body('mvp_status').optional().isIn(['Idea', 'Prototype', 'Beta', 'Launched']),
    body('description').optional().trim(),
    body('funding_goal').optional().isFloat({ min: 0 }),
    body('team_size').optional().isInt({ min: 0 }),
    body('founded_year').optional().isInt({ min: 1900, max: 2100 }),
    body('location').optional().trim(),
    body('website').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const [rows] = await db.query('SELECT * FROM portfolios WHERE id = ? AND owner_id = ?', [
        req.params.id,
        req.user.id,
      ]);

      if (rows.length === 0) return res.status(404).json({ error: 'Portfolio not found' });
      const portfolio = rows[0];

      // Can edit in draft, rejected, or approved
      if (!['draft', 'rejected', 'approved'].includes(portfolio.status)) {
        return res.status(400).json({ error: 'This portfolio cannot be edited right now' });
      }

      const updated = {
        name: req.body.name ?? portfolio.name,
        sector: req.body.sector ?? portfolio.sector,
        mvp_status: req.body.mvp_status ?? portfolio.mvp_status,
        description: req.body.description ?? portfolio.description,
        funding_goal: req.body.funding_goal ?? portfolio.funding_goal,
        team_size: req.body.team_size ?? portfolio.team_size,
        founded_year: req.body.founded_year ?? portfolio.founded_year,
        location: req.body.location ?? portfolio.location,
        website: req.body.website ?? portfolio.website,
      };

      const [docCount] = await db.query(
        'SELECT COUNT(*) AS c FROM portfolio_documents WHERE portfolio_id = ?',
        [req.params.id]
      );
      const readiness_score = calcReadinessScore(updated, docCount[0].c);

      await db.query(
        `UPDATE portfolios
         SET name=?, sector=?, mvp_status=?, description=?, funding_goal=?, team_size=?, founded_year=?, location=?, website=?, readiness_score=?
         WHERE id=?`,
        [
          updated.name, updated.sector, updated.mvp_status, updated.description, updated.funding_goal,
          updated.team_size, updated.founded_year, updated.location, updated.website,
          readiness_score, req.params.id,
        ]
      );

      const [fresh] = await db.query('SELECT * FROM portfolios WHERE id = ?', [req.params.id]);
      res.json(fresh[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// POST /api/portfolios/:id/submit  — submit for admin review
router.post('/:id/submit', authenticate, requireRole('business_owner'), async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM portfolios WHERE id = ? AND owner_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Portfolio not found' });
    const portfolio = rows[0];

    if (!['draft', 'rejected', 'approved'].includes(portfolio.status)) {
      return res.status(400).json({ error: 'Portfolio is already pending review' });
    }

    await db.query(
      "UPDATE portfolios SET status='pending', submitted_at=NOW(), rejection_reason=NULL WHERE id=?",
      [req.params.id]
    );

    // Notify admins
    const [admins] = await db.query("SELECT id FROM users WHERE role='admin'");
    const notifValues = admins.map((a) => [
      a.id,
      'portfolio_submitted',
      'New Portfolio Submitted',
      `${req.user.name} submitted "${portfolio.name}" for review`,
      req.params.id,
      req.user.id,
    ]);
    if (notifValues.length > 0) {
      await db.query(
        'INSERT INTO notifications (user_id, type, title, body, related_portfolio_id, related_user_id) VALUES ?',
        [notifValues]
      );
    }

    res.json({ message: 'Portfolio submitted for review' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/portfolios/:id  — delete own portfolio (any status)
router.delete('/:id', authenticate, requireRole('business_owner'), async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM portfolios WHERE id = ? AND owner_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    await db.query('DELETE FROM portfolios WHERE id = ?', [req.params.id]);
    res.json({ message: 'Portfolio deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
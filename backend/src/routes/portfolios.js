const express = require('express');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { submitPortfolio } = require('../services/workflow');

const router = express.Router();

function sendWorkflowError(res, error) {
  if (error && Number.isInteger(error.status)) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: 'Server error' });
}

const optFloat = (min = 0) => (v) => {
  if (v == null || v === '') return true;
  const n = Number(v);
  if (!isNaN(n) && n >= min) return true;
  throw new Error(`Must be a number >= ${min}`);
};
const optInt = (min = 0, max) => (v) => {
  if (v == null || v === '') return true;
  const n = Number(v);
  if (Number.isInteger(n) && n >= min && (max == null || n <= max)) return true;
  throw new Error(`Must be an integer >= ${min}`);
};

// Readiness score based on Village Capital / SICouncil methodology
// Dimensions: Team (25) + Traction (25) + Market (20) + Product (15) + Financials (15) = 100
function calcReadinessScore(portfolio, docCount) {
  let score = 0;

  // TEAM (25 pts)
  if (portfolio.team_size >= 1) score += 8;
  if (portfolio.team_size >= 3) score += 5;
  if (portfolio.advisor_names && String(portfolio.advisor_names).trim()) score += 7;
  if (portfolio.founded_year) score += 5;

  // TRACTION (25 pts)
  if (portfolio.monthly_revenue > 0) score += 12;
  if (portfolio.user_count > 0) score += 8;
  if (portfolio.growth_rate > 0) score += 5;

  // MARKET (20 pts)
  if (portfolio.market_size && String(portfolio.market_size).trim()) score += 8;
  if (portfolio.competitor_analysis && String(portfolio.competitor_analysis).trim()) score += 7;
  if (portfolio.description && portfolio.description.length > 50) score += 5;

  // PRODUCT (15 pts)
  const mvpPoints = { Idea: 3, Prototype: 7, Beta: 11, Launched: 15 };
  score += mvpPoints[portfolio.mvp_status] || 0;

  // FINANCIALS (15 pts)
  if (portfolio.funding_goal > 0) score += 5;
  if (portfolio.burn_rate != null && portfolio.burn_rate >= 0) score += 5;
  if (portfolio.runway_months > 0) score += 5;

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
    body('funding_goal').custom(optFloat(0)),
    body('team_size').custom(optInt(0)),
    body('founded_year').custom(optInt(1900, 2100)),
    body('location').optional().trim(),
    body('website').optional().trim(),
    body('monthly_revenue').custom(optFloat(0)),
    body('user_count').custom(optInt(0)),
    body('growth_rate').custom(optFloat(0)),
    body('market_size').optional().trim(),
    body('competitor_analysis').optional().trim(),
    body('advisor_names').optional().trim(),
    body('burn_rate').custom(optFloat(0)),
    body('runway_months').custom(optInt(0)),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      name, sector, mvp_status,
      description = '', funding_goal = 0,
      team_size = null, founded_year = null, location = null, website = null,
      monthly_revenue = null, user_count = null, growth_rate = null,
      market_size = null, competitor_analysis = null, advisor_names = null,
      burn_rate = null, runway_months = null,
    } = req.body;
    const readiness_score = calcReadinessScore(req.body, 0);

    try {
      const [result] = await db.query(
        `INSERT INTO portfolios
          (owner_id, name, sector, mvp_status, description, funding_goal, team_size, founded_year, location, website,
           monthly_revenue, user_count, growth_rate, market_size, competitor_analysis, advisor_names, burn_rate, runway_months,
           readiness_score, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id, name, sector, mvp_status, description, funding_goal,
          team_size, founded_year, location, website,
          monthly_revenue, user_count, growth_rate, market_size, competitor_analysis, advisor_names, burn_rate, runway_months,
          readiness_score, 'draft',
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
    body('funding_goal').custom(optFloat(0)),
    body('team_size').custom(optInt(0)),
    body('founded_year').custom(optInt(1900, 2100)),
    body('location').optional().trim(),
    body('website').optional().trim(),
    body('monthly_revenue').custom(optFloat(0)),
    body('user_count').custom(optInt(0)),
    body('growth_rate').custom(optFloat(0)),
    body('market_size').optional().trim(),
    body('competitor_analysis').optional().trim(),
    body('advisor_names').optional().trim(),
    body('burn_rate').custom(optFloat(0)),
    body('runway_months').custom(optInt(0)),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const [rows] = await db.query('SELECT * FROM portfolios WHERE id = ? AND owner_id = ?', [
        req.params.id, req.user.id,
      ]);

      if (rows.length === 0) return res.status(404).json({ error: 'Portfolio not found' });
      const portfolio = rows[0];

      if (!['draft', 'rejected', 'approved', 'pending'].includes(portfolio.status)) {
        return res.status(400).json({ error: 'This portfolio cannot be edited right now' });
      }

      const pick = (key, fallback) =>
        Object.prototype.hasOwnProperty.call(req.body, key) ? req.body[key] : fallback;

      const updated = {
        name: pick('name', portfolio.name),
        sector: pick('sector', portfolio.sector),
        mvp_status: pick('mvp_status', portfolio.mvp_status),
        description: pick('description', portfolio.description),
        funding_goal: pick('funding_goal', portfolio.funding_goal),
        team_size: pick('team_size', portfolio.team_size),
        founded_year: pick('founded_year', portfolio.founded_year),
        location: pick('location', portfolio.location),
        website: pick('website', portfolio.website),
        monthly_revenue: pick('monthly_revenue', portfolio.monthly_revenue),
        user_count: pick('user_count', portfolio.user_count),
        growth_rate: pick('growth_rate', portfolio.growth_rate),
        market_size: pick('market_size', portfolio.market_size),
        competitor_analysis: pick('competitor_analysis', portfolio.competitor_analysis),
        advisor_names: pick('advisor_names', portfolio.advisor_names),
        burn_rate: pick('burn_rate', portfolio.burn_rate),
        runway_months: pick('runway_months', portfolio.runway_months),
      };

      const [docCount] = await db.query(
        'SELECT COUNT(*) AS c FROM portfolio_documents WHERE portfolio_id = ?',
        [req.params.id]
      );
      const readiness_score = calcReadinessScore(updated, docCount[0].c);

      const wasResetToDraft = portfolio.status === 'pending';
      const newStatus = wasResetToDraft ? 'draft' : portfolio.status;

      await db.query(
        `UPDATE portfolios
         SET name=?, sector=?, mvp_status=?, description=?, funding_goal=?, team_size=?, founded_year=?, location=?, website=?,
             monthly_revenue=?, user_count=?, growth_rate=?, market_size=?, competitor_analysis=?, advisor_names=?, burn_rate=?, runway_months=?,
             readiness_score=?, status=?, submitted_at=?
         WHERE id=?`,
        [
          updated.name, updated.sector, updated.mvp_status, updated.description, updated.funding_goal,
          updated.team_size, updated.founded_year, updated.location, updated.website,
          updated.monthly_revenue, updated.user_count, updated.growth_rate, updated.market_size,
          updated.competitor_analysis, updated.advisor_names, updated.burn_rate, updated.runway_months,
          readiness_score, newStatus, wasResetToDraft ? null : portfolio.submitted_at,
          req.params.id,
        ]
      );

      const [fresh] = await db.query('SELECT * FROM portfolios WHERE id = ?', [req.params.id]);
      res.json({ ...fresh[0], was_reset_to_draft: wasResetToDraft });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// POST /api/portfolios/:id/submit  — submit for admin review
router.post('/:id/submit', authenticate, requireRole('business_owner'), async (req, res) => {
  try {
    const result = await submitPortfolio({
      portfolioId: req.params.id,
      ownerId: req.user.id,
      ownerName: req.user.name,
    });
    res.json(result);
  } catch (err) {
    sendWorkflowError(res, err);
  }
});

// POST /api/portfolios/:id/documents  — upload supporting documents
router.post(
  '/:id/documents',
  authenticate,
  requireRole('business_owner'),
  upload.array('documents', 5),
  async (req, res) => {
    try {
      const [rows] = await db.query(
        'SELECT * FROM portfolios WHERE id = ? AND owner_id = ?',
        [req.params.id, req.user.id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Portfolio not found' });
      }
 
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }
 
      const values = req.files.map((f) => [
        req.params.id,
        f.originalname,
        `/uploads/portfolio-documents/${f.filename}`,
        f.mimetype,
      ]);
 
      await db.query(
        'INSERT INTO portfolio_documents (portfolio_id, file_name, file_url, file_type) VALUES ?',
        [values]
      );
 
      const [docCount] = await db.query(
        'SELECT COUNT(*) AS c FROM portfolio_documents WHERE portfolio_id = ?',
        [req.params.id]
      );
      const readiness_score = calcReadinessScore(rows[0], docCount[0].c);
      await db.query('UPDATE portfolios SET readiness_score = ? WHERE id = ?', [
        readiness_score,
        req.params.id,
      ]);
 
      const [docs] = await db.query(
        'SELECT * FROM portfolio_documents WHERE portfolio_id = ? ORDER BY uploaded_at DESC',
        [req.params.id]
      );
 
      res.status(201).json({ documents: docs, readiness_score });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);
 
// DELETE /api/portfolios/:id/documents/:docId  — remove a supporting document
router.delete(
  '/:id/documents/:docId',
  authenticate,
  requireRole('business_owner'),
  async (req, res) => {
    try {
      const [portfolioRows] = await db.query(
        'SELECT * FROM portfolios WHERE id = ? AND owner_id = ?',
        [req.params.id, req.user.id]
      );
      if (portfolioRows.length === 0) {
        return res.status(404).json({ error: 'Portfolio not found' });
      }
 
      const [docRows] = await db.query(
        'SELECT * FROM portfolio_documents WHERE id = ? AND portfolio_id = ?',
        [req.params.docId, req.params.id]
      );
      if (docRows.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }
 
      await db.query('DELETE FROM portfolio_documents WHERE id = ?', [req.params.docId]);
 
      // Remove the file from disk too
      const filePath = path.join(__dirname, '..', '..', docRows[0].file_url);
      fs.unlink(filePath, () => {});
 
      const [docCount] = await db.query(
        'SELECT COUNT(*) AS c FROM portfolio_documents WHERE portfolio_id = ?',
        [req.params.id]
      );
      const readiness_score = calcReadinessScore(portfolioRows[0], docCount[0].c);
      await db.query('UPDATE portfolios SET readiness_score = ? WHERE id = ?', [
        readiness_score,
        req.params.id,
      ]);
 
      res.json({ message: 'Document deleted', readiness_score });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

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

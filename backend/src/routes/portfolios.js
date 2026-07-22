const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const {
  deleteEditablePortfolio,
  deletePortfolioDocument,
  resolveStoredUploadPath,
  saveUploadedDocuments,
} = require('../services/document-workflow');
const { submitPortfolio, updatePortfolioDetails } = require('../services/workflow');

const router = express.Router();

function sendWorkflowError(res, error) {
  if (error && error.cleanupError) {
    console.error('Document file cleanup failed', error.cleanupError);
  }
  if (error && error.restoreError) {
    console.error('Document file restore failed', error.restoreError);
  }
  if (error && Number.isInteger(error.status)) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: 'Server error' });
}

async function loadOwnedEditablePortfolio(req, res, next) {
  try {
    const [rows] = await db.query(
      'SELECT * FROM portfolios WHERE id = ? AND owner_id = ?',
      [req.params.id, req.user.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const portfolio = rows[0];
    if (portfolio.status === 'pending') {
      return res.status(409).json({ error: 'A pending portfolio cannot be edited' });
    }
    if (!['draft', 'approved', 'rejected'].includes(portfolio.status)) {
      return res.status(409).json({ error: 'This portfolio cannot be edited right now' });
    }

    req.portfolio = portfolio;
    return next();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
}

const withDownloadUrl = (doc) => ({
  ...doc,
  download_url: `/api/portfolios/${doc.portfolio_id}/documents/${doc.id}/download`,
});

async function relationshipManagerCanAccessPortfolio(userId, portfolioId) {
  const [rows] = await db.query(
    `SELECT 1
       FROM conversations c
       JOIN conversation_members cm
         ON cm.conversation_id=c.id
        AND cm.user_id=?
        AND cm.member_role='relationship_manager'
        AND cm.membership_status='active'
      WHERE c.portfolio_id=? AND c.relationship_manager_id=?
      LIMIT 1`,
    [userId, portfolioId, userId],
  );
  return rows.length === 1;
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
        (SELECT COUNT(*) FROM investor_interests WHERE portfolio_id = p.id) AS interest_count,
        CASE WHEN owner_member.user_id IS NULL THEN NULL ELSE c.id END AS conversation_id,
        CASE WHEN owner_member.user_id IS NULL THEN NULL ELSE c.status END AS conversation_status,
        CASE
          WHEN owner_member.user_id IS NULL THEN 'awaiting_manager'
          WHEN c.status='active' THEN 'open'
          ELSE 'archived'
        END AS chat_state
       FROM portfolios p
       LEFT JOIN conversations c ON c.portfolio_id=p.id
       LEFT JOIN conversation_members owner_member
         ON owner_member.conversation_id=c.id
        AND owner_member.user_id=?
        AND owner_member.member_role='business_owner'
        AND owner_member.membership_status='active'
       WHERE p.owner_id = ?
       ORDER BY p.updated_at DESC`,
      [req.user.id, req.user.id]
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
        (SELECT COUNT(*) FROM investor_interests WHERE portfolio_id = p.id) AS interest_count,
        CASE WHEN investor_member.user_id IS NULL THEN NULL ELSE c.id END AS conversation_id,
        CASE WHEN investor_member.user_id IS NULL THEN NULL ELSE c.status END AS conversation_status,
        CASE
          WHEN investor_member.user_id IS NULL THEN 'awaiting_manager'
          WHEN c.status='active' THEN 'open'
          ELSE 'archived'
        END AS chat_state
      FROM portfolios p
      JOIN users u ON u.id = p.owner_id
      LEFT JOIN conversations c ON c.portfolio_id=p.id
      LEFT JOIN conversation_members investor_member
        ON investor_member.conversation_id=c.id
       AND investor_member.user_id=?
       AND investor_member.member_role='investor'
       AND investor_member.membership_status='active'
      WHERE p.status = 'approved'
    `;
    const params = [req.user.id];

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
    if (
      req.user.role === 'relationship_manager'
      && !(await relationshipManagerCanAccessPortfolio(req.user.id, portfolio.id))
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [docs] = await db.query(
      'SELECT * FROM portfolio_documents WHERE portfolio_id = ? ORDER BY uploaded_at DESC',
      [req.params.id]
    );

    res.json({ ...portfolio, documents: docs.map(withDownloadUrl) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/portfolios/:id/documents/:docId/download — authorized attachment
router.get('/:id/documents/:docId/download', authenticate, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, p.owner_id, p.status
         FROM portfolio_documents d
         JOIN portfolios p ON p.id=d.portfolio_id
        WHERE d.id=? AND p.id=?`,
      [req.params.docId, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Document not found' });

    const doc = rows[0];
    let allowed = req.user.role === 'admin'
      || Number(doc.owner_id) === Number(req.user.id)
      || (req.user.role === 'investor' && doc.status === 'approved');
    if (req.user.role === 'relationship_manager') {
      allowed = await relationshipManagerCanAccessPortfolio(req.user.id, doc.portfolio_id);
    }
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    let absolute;
    try {
      absolute = resolveStoredUploadPath(doc.file_url);
    } catch (error) {
      return res.status(404).json({ error: 'Document not found' });
    }
    return res.download(absolute, doc.file_name);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
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
      const result = await updatePortfolioDetails({
        portfolioId: req.params.id,
        ownerId: req.user.id,
        payload: req.body,
        calculateReadiness: calcReadinessScore,
      });
      return res.json(result);
    } catch (err) {
      return sendWorkflowError(res, err);
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
  loadOwnedEditablePortfolio,
  upload.array('documents', 5),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const result = await saveUploadedDocuments({
        database: db,
        portfolioId: req.params.id,
        ownerId: req.user.id,
        files: req.files,
        calculateReadiness: calcReadinessScore,
      });

      return res.status(201).json({
        documents: result.documents.map(withDownloadUrl),
        readiness_score: result.readinessScore,
      });
    } catch (err) {
      return sendWorkflowError(res, err);
    }
  }
);
 
// DELETE /api/portfolios/:id/documents/:docId  — remove a supporting document
router.delete(
  '/:id/documents/:docId',
  authenticate,
  requireRole('business_owner'),
  loadOwnedEditablePortfolio,
  async (req, res) => {
    try {
      const result = await deletePortfolioDocument({
        database: db,
        portfolioId: req.params.id,
        documentId: req.params.docId,
        ownerId: req.user.id,
        calculateReadiness: calcReadinessScore,
      });
      if (result.cleanupError) {
        console.error('Deleted document file cleanup failed', result.cleanupError);
      }

      return res.json({
        message: 'Document deleted',
        readiness_score: result.readinessScore,
      });
    } catch (err) {
      return sendWorkflowError(res, err);
    }
  }
);

// DELETE /api/portfolios/:id  — delete an editable portfolio
router.delete('/:id', authenticate, requireRole('business_owner'), async (req, res) => {
  try {
    const result = await deleteEditablePortfolio({
      database: db,
      portfolioId: req.params.id,
      ownerId: req.user.id,
    });
    if (result.cleanupError) {
      console.error('Deleted portfolio file cleanup failed', result.cleanupError);
    }

    return res.json({ message: 'Portfolio deleted' });
  } catch (err) {
    return sendWorkflowError(res, err);
  }
});

module.exports = router;

const express = require('express');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const workflow = require('../services/workflow');
const managedConversationWorkflow = require('../services/managed-conversation-workflow');

const router = express.Router();

function sendWorkflowError(res, error) {
  if (
    (
      error instanceof workflow.WorkflowError
      || error instanceof managedConversationWorkflow.ManagedConversationError
    )
    && Number.isInteger(error.status)
    && error.status >= 400
    && error.status < 500
  ) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
  console.error('Interest workflow failed');
  return res.status(500).json({ error: 'Server error' });
}

function positivePortfolioId(req, res) {
  const portfolioId = Number(req.params.portfolioId);
  if (!Number.isSafeInteger(portfolioId) || portfolioId <= 0) {
    res.status(400).json({ error: 'A positive portfolio ID is required' });
    return null;
  }
  return portfolioId;
}

// POST /api/interests/:portfolioId  — investor expresses interest
router.post('/:portfolioId', authenticate, requireRole('investor'), async (req, res) => {
  const portfolioId = positivePortfolioId(req, res);
  if (portfolioId == null) return;

  try {
    const result = await workflow.expressInterest({
      portfolioId,
      investorId: req.user.id,
      investorName: req.user.name,
    });
    if (!result.created) {
      return res.status(200).json({ message: 'Interest already recorded' });
    }
    res.status(201).json({ message: 'Interest expressed' });
  } catch (err) {
    sendWorkflowError(res, err);
  }
});

// DELETE /api/interests/:portfolioId  — investor removes interest
router.delete('/:portfolioId', authenticate, requireRole('investor'), async (req, res) => {
  const portfolioId = positivePortfolioId(req, res);
  if (portfolioId == null) return;

  try {
    await managedConversationWorkflow.withdrawInvestorInterest({
      database: db,
      investorId: req.user.id,
      portfolioId,
    });
    res.json({ message: 'Interest removed' });
  } catch (err) {
    sendWorkflowError(res, err);
  }
});

// GET /api/interests/my  — investor: portfolios I'm interested in
router.get('/my', authenticate, requireRole('investor'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.owner_id, p.name, p.sector, p.readiness_score, p.funding_goal,
        p.relationship_manager_id,
        u.name AS owner_name, ii.created_at AS interested_at,
        CASE WHEN investor_member.membership_status='active' THEN c.id ELSE NULL END AS conversation_id,
        CASE WHEN investor_member.membership_status='active' THEN c.status ELSE NULL END AS conversation_status,
        CASE
          WHEN investor_member.membership_status='removed' THEN 'removed'
          WHEN investor_member.membership_status='active' AND c.status='active' THEN 'open'
          WHEN investor_member.membership_status='active' THEN 'archived'
          ELSE 'awaiting_manager'
        END AS chat_state
       FROM investor_interests ii
       JOIN portfolios p ON p.id = ii.portfolio_id
       JOIN users u ON u.id = p.owner_id
       LEFT JOIN conversations c ON c.portfolio_id=p.id
       LEFT JOIN conversation_members investor_member
         ON investor_member.conversation_id=c.id
        AND investor_member.user_id=ii.investor_id
        AND investor_member.member_role='investor'
       WHERE ii.investor_id = ?
       ORDER BY ii.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Investor interest list failed');
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/interests/received  — business owner: who is interested in my portfolios
router.get('/received', authenticate, requireRole('business_owner'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ii.id, ii.created_at, u.id AS investor_id, u.name AS investor_name, u.email AS investor_email,
        p.id AS portfolio_id, p.name AS portfolio_name,
        CASE WHEN owner_member.user_id IS NULL THEN NULL ELSE c.id END AS conversation_id,
        CASE WHEN owner_member.user_id IS NULL THEN NULL ELSE c.status END AS conversation_status,
        CASE
          WHEN owner_member.user_id IS NULL THEN 'awaiting_manager'
          WHEN c.status='active' THEN 'open'
          ELSE 'archived'
        END AS chat_state
       FROM investor_interests ii
       JOIN users u ON u.id = ii.investor_id
       JOIN portfolios p ON p.id = ii.portfolio_id
       LEFT JOIN conversations c ON c.portfolio_id=p.id
       LEFT JOIN conversation_members owner_member
         ON owner_member.conversation_id=c.id
        AND owner_member.user_id=p.owner_id
        AND owner_member.member_role='business_owner'
        AND owner_member.membership_status='active'
       WHERE p.owner_id = ?
       ORDER BY ii.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Owner interest list failed');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

const express = require('express');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { normalizeReadinessScore } = require('../validation/database-boundaries');

const router = express.Router();

/**
 * AI Recommendation scoring:
 * Each approved portfolio gets a relevance score for the requesting investor based on:
 *   - readiness_score (40%) — how complete/ready the startup is
 *   - interest_count (30%) — validated by other investors (social proof)
 *   - recency (20%) — newer = slightly more relevant
 *   - not_already_interested (10%) — penalize portfolios investor already expressed interest in
 */
function computeScore(portfolio, alreadyInterestedIds, maxInterests, oldestDate) {
  const readinessComponent = (portfolio.readiness_score / 100) * 40;

  const interestComponent =
    maxInterests > 0 ? (portfolio.interest_count / maxInterests) * 30 : 0;

  const now = Date.now();
  const created = new Date(portfolio.created_at).getTime();
  const oldest = new Date(oldestDate).getTime();
  const range = now - oldest || 1;
  const recencyComponent = ((created - oldest) / range) * 20;

  const penaltyComponent = alreadyInterestedIds.has(portfolio.id) ? 0 : 10;

  return Math.round(readinessComponent + interestComponent + recencyComponent + penaltyComponent);
}

// GET /api/recommendations  — AI-ranked startups for the logged-in investor
router.get('/', authenticate, requireRole('investor'), async (req, res) => {
  try {
    const [portfolios] = await db.query(
      `SELECT p.id, p.name, p.sector, p.description, p.funding_goal, p.readiness_score, p.created_at,
        u.name AS owner_name,
        (SELECT COUNT(*) FROM investor_interests WHERE portfolio_id = p.id) AS interest_count
       FROM portfolios p
       JOIN users u ON u.id = p.owner_id
       WHERE p.status = 'approved'`
    );

    if (portfolios.length === 0) return res.json([]);

    // Get this investor's existing interests
    const [myInterests] = await db.query(
      'SELECT portfolio_id FROM investor_interests WHERE investor_id = ?',
      [req.user.id]
    );
    const alreadyInterestedIds = new Set(myInterests.map((r) => r.portfolio_id));

    const maxInterests = Math.max(...portfolios.map((p) => p.interest_count), 1);
    const oldestDate = portfolios.reduce(
      (oldest, p) => (new Date(p.created_at) < new Date(oldest) ? p.created_at : oldest),
      portfolios[0].created_at
    );

    const ranked = portfolios
      .map((p) => {
        const readinessScore = normalizeReadinessScore(p.readiness_score);
        const normalizedPortfolio = {
          ...p,
          readiness_score: readinessScore,
        };
        return {
          ...normalizedPortfolio,
          ai_score: computeScore(
            normalizedPortfolio,
            alreadyInterestedIds,
            maxInterests,
            oldestDate,
          ),
          is_high_potential: readinessScore >= 75,
          already_interested: alreadyInterestedIds.has(p.id),
        };
      })
      .sort((a, b) => b.ai_score - a.ai_score);

    res.json(ranked);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

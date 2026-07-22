const db = require('../config/db');
const {
  archiveConversationForPortfolio,
} = require('./managed-conversation-workflow');

class WorkflowError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function inTransaction(work) {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function submitPortfolio({ portfolioId, ownerId, ownerName }) {
  return inTransaction(async (connection) => {
    const [rows] = await connection.query(
      'SELECT id, owner_id, name, status FROM portfolios WHERE id=? AND owner_id=? FOR UPDATE',
      [portfolioId, ownerId],
    );
    if (!rows.length) throw new WorkflowError(404, 'Portfolio not found');
    if (rows[0].status === 'pending') {
      throw new WorkflowError(409, 'Portfolio is already pending review');
    }

    if (rows[0].status === 'approved') {
      await archiveConversationForPortfolio(
        connection,
        portfolioId,
        'portfolio_unapproved',
        ownerId,
      );
    }

    await connection.query(
      "UPDATE portfolios SET status='pending', submitted_at=NOW(), rejection_reason=NULL WHERE id=?",
      [portfolioId],
    );
    const [admins] = await connection.query("SELECT id FROM users WHERE role='admin'");
    if (admins.length) {
      const values = admins.map(({ id }) => [
        id,
        'portfolio_submitted',
        'New Portfolio Submitted',
        `${ownerName} submitted "${rows[0].name}" for review`,
        portfolioId,
        ownerId,
      ]);
      await connection.query(
        'INSERT INTO notifications (user_id,type,title,body,related_portfolio_id,related_user_id) VALUES ?',
        [values],
      );
    }
    return { message: 'Portfolio submitted for review' };
  });
}

async function moderatePortfolio({ portfolioId, adminId, action, reason }) {
  if (!['approved', 'rejected'].includes(action)) {
    throw new WorkflowError(400, 'Invalid moderation action');
  }

  return inTransaction(async (connection) => {
    const [rows] = await connection.query(
      "SELECT id,owner_id,name,status FROM portfolios WHERE id=? AND status='pending' FOR UPDATE",
      [portfolioId],
    );
    if (!rows.length) throw new WorkflowError(404, 'Pending portfolio not found');

    const rejected = action === 'rejected';
    const [update] = await connection.query(
      "UPDATE portfolios SET status=?, rejection_reason=? WHERE id=? AND status='pending'",
      [action, rejected ? reason : null, portfolioId],
    );
    if (update.affectedRows !== 1) {
      throw new WorkflowError(409, 'Portfolio has already been moderated');
    }

    if (rejected) {
      await archiveConversationForPortfolio(
        connection,
        portfolioId,
        'portfolio_unapproved',
        adminId,
      );
    }

    await connection.query(
      'INSERT INTO audit_logs (admin_id,action,portfolio_id,reason) VALUES (?,?,?,?)',
      [adminId, action, portfolioId, rejected ? reason : null],
    );
    await connection.query(
      'INSERT INTO notifications (user_id,type,title,body,related_portfolio_id,related_user_id) VALUES (?,?,?,?,?,?)',
      [
        rows[0].owner_id,
        rejected ? 'portfolio_rejected' : 'portfolio_approved',
        rejected ? 'Portfolio Rejected' : 'Portfolio Approved!',
        rejected
          ? `Your portfolio "${rows[0].name}" was rejected: ${reason}`
          : `Your portfolio "${rows[0].name}" has been approved and is now visible to investors`,
        portfolioId,
        adminId,
      ],
    );
    return { message: rejected ? 'Portfolio rejected' : 'Portfolio approved' };
  });
}

async function expressInterest({ portfolioId, investorId, investorName }) {
  return inTransaction(async (connection) => {
    const [rows] = await connection.query(
      "SELECT id,owner_id,name FROM portfolios WHERE id=? AND status='approved' FOR UPDATE",
      [portfolioId],
    );
    if (!rows.length) throw new WorkflowError(404, 'Approved portfolio not found');

    const [insert] = await connection.query(
      'INSERT IGNORE INTO investor_interests (investor_id,portfolio_id) VALUES (?,?)',
      [investorId, portfolioId],
    );
    if (!insert.affectedRows) return { created: false };

    await connection.query(
      'INSERT INTO notifications (user_id,type,title,body,related_portfolio_id,related_user_id) VALUES (?,?,?,?,?,?)',
      [
        rows[0].owner_id,
        'new_interest',
        'New Investor Interest!',
        `${investorName} is interested in "${rows[0].name}"`,
        portfolioId,
        investorId,
      ],
    );
    return { created: true };
  });
}

const EDITABLE_FIELDS = [
  'name',
  'sector',
  'mvp_status',
  'description',
  'funding_goal',
  'team_size',
  'founded_year',
  'location',
  'website',
  'monthly_revenue',
  'user_count',
  'growth_rate',
  'market_size',
  'competitor_analysis',
  'advisor_names',
  'burn_rate',
  'runway_months',
];

async function updatePortfolioDetails({
  portfolioId,
  ownerId,
  payload,
  calculateReadiness,
}) {
  return inTransaction(async (connection) => {
    const [rows] = await connection.query(
      'SELECT * FROM portfolios WHERE id=? AND owner_id=? FOR UPDATE',
      [portfolioId, ownerId],
    );
    if (!rows.length) throw new WorkflowError(404, 'Portfolio not found');
    const portfolio = rows[0];
    if (portfolio.status === 'pending') {
      throw new WorkflowError(409, 'A pending portfolio cannot be edited');
    }
    if (!['draft', 'approved', 'rejected'].includes(portfolio.status)) {
      throw new WorkflowError(409, 'This portfolio cannot be edited right now');
    }

    const updated = Object.fromEntries(EDITABLE_FIELDS.map((field) => [
      field,
      Object.prototype.hasOwnProperty.call(payload, field)
        ? payload[field]
        : portfolio[field],
    ]));
    const [[{ c: documentCount }]] = await connection.query(
      'SELECT COUNT(*) AS c FROM portfolio_documents WHERE portfolio_id=?',
      [portfolioId],
    );
    const readinessScore = calculateReadiness(updated, Number(documentCount));
    if (portfolio.status === 'approved') {
      await archiveConversationForPortfolio(
        connection,
        portfolioId,
        'portfolio_unapproved',
        ownerId,
      );
    }

    await connection.query(
      `UPDATE portfolios
          SET name=?,sector=?,mvp_status=?,description=?,funding_goal=?,
              team_size=?,founded_year=?,location=?,website=?,monthly_revenue=?,
              user_count=?,growth_rate=?,market_size=?,competitor_analysis=?,
              advisor_names=?,burn_rate=?,runway_months=?,readiness_score=?,
              status=?,submitted_at=?,rejection_reason=?
        WHERE id=? AND owner_id=?`,
      [
        updated.name,
        updated.sector,
        updated.mvp_status,
        updated.description,
        updated.funding_goal,
        updated.team_size,
        updated.founded_year,
        updated.location,
        updated.website,
        updated.monthly_revenue,
        updated.user_count,
        updated.growth_rate,
        updated.market_size,
        updated.competitor_analysis,
        updated.advisor_names,
        updated.burn_rate,
        updated.runway_months,
        readinessScore,
        'draft',
        null,
        null,
        portfolioId,
        ownerId,
      ],
    );
    const [fresh] = await connection.query(
      'SELECT * FROM portfolios WHERE id=?',
      [portfolioId],
    );
    return {
      ...fresh[0],
      was_reset_to_draft: portfolio.status !== 'draft',
    };
  });
}

module.exports = {
  WorkflowError,
  expressInterest,
  moderatePortfolio,
  submitPortfolio,
  updatePortfolioDetails,
};

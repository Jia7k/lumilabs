const db = require('../config/db');
const {
  archiveConversationForPortfolio,
  reconcileConversationAfterApproval,
} = require('./managed-conversation-workflow');

class WorkflowError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'WorkflowError';
    this.status = status;
    this.code = code;
  }
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new WorkflowError(400, `A positive ${label} is required`, 'INVALID_ID');
  }
  return id;
}

async function inTransaction(work) {
  const connection = await db.getConnection();
  let transactionOpen = false;
  let releaseConnection = true;
  try {
    await connection.beginTransaction();
    transactionOpen = true;
    const result = await work(connection);
    await connection.commit();
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await connection.rollback();
      } catch {
        console.error('Workflow transaction rollback failed');
        releaseConnection = false;
        if (typeof connection.destroy === 'function') {
          try {
            await connection.destroy();
          } catch {
            // Keep the original workflow error as the public failure.
          }
        }
      }
    }
    throw error;
  } finally {
    if (releaseConnection) {
      try {
        connection.release();
      } catch {
        console.error('Workflow connection release failed');
      }
    }
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
  const normalizedAction = {
    approve: 'approved',
    approved: 'approved',
    reject: 'rejected',
    rejected: 'rejected',
  }[action];
  if (!normalizedAction) {
    throw new WorkflowError(400, 'Invalid moderation action', 'INVALID_ACTION');
  }
  const canonicalPortfolioId = positiveId(portfolioId, 'portfolio ID');
  const canonicalAdminId = positiveId(adminId, 'admin ID');

  return inTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT id,owner_id,name,status,relationship_manager_id
         FROM portfolios
        WHERE id=?
        FOR UPDATE`,
      [canonicalPortfolioId],
    );
    if (!rows.length) {
      throw new WorkflowError(
        404,
        'Pending portfolio not found',
        'PENDING_PORTFOLIO_NOT_FOUND',
      );
    }
    if (rows[0].status !== 'pending') {
      throw new WorkflowError(
        409,
        'Portfolio has already been moderated',
        'MODERATION_CONFLICT',
      );
    }

    const rejected = normalizedAction === 'rejected';
    const [update] = await connection.query(
      "UPDATE portfolios SET status=?, rejection_reason=? WHERE id=? AND status='pending'",
      [
        normalizedAction,
        rejected ? reason : null,
        canonicalPortfolioId,
      ],
    );
    if (update.affectedRows !== 1) {
      throw new WorkflowError(
        409,
        'Portfolio has already been moderated',
        'MODERATION_CONFLICT',
      );
    }

    if (rejected) {
      await archiveConversationForPortfolio(
        connection,
        canonicalPortfolioId,
        'portfolio_unapproved',
        canonicalAdminId,
      );
    } else {
      await reconcileConversationAfterApproval(
        connection,
        canonicalPortfolioId,
        canonicalAdminId,
      );
    }

    await connection.query(
      'INSERT INTO audit_logs (admin_id,action,portfolio_id,reason) VALUES (?,?,?,?)',
      [
        canonicalAdminId,
        normalizedAction,
        canonicalPortfolioId,
        rejected ? reason : null,
      ],
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
        canonicalPortfolioId,
        canonicalAdminId,
      ],
    );
    return { message: rejected ? 'Portfolio rejected' : 'Portfolio approved' };
  });
}

async function expressInterest({ portfolioId, investorId, investorName }) {
  const canonicalPortfolioId = positiveId(portfolioId, 'portfolio ID');
  const canonicalInvestorId = positiveId(investorId, 'investor ID');
  return inTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT p.id,p.name,p.owner_id,p.status,p.relationship_manager_id,
              owner.name AS owner_name
         FROM portfolios p
         JOIN users owner ON owner.id=p.owner_id
        WHERE p.id=?
        FOR UPDATE`,
      [canonicalPortfolioId],
    );
    if (!rows.length) {
      throw new WorkflowError(404, 'Portfolio not found', 'PORTFOLIO_NOT_FOUND');
    }
    const portfolio = rows[0];
    if (portfolio.status !== 'approved') {
      throw new WorkflowError(
        409,
        'Interest can only be expressed in an approved portfolio',
        'PORTFOLIO_NOT_APPROVED',
      );
    }

    const [insert] = await connection.query(
      'INSERT IGNORE INTO investor_interests (investor_id,portfolio_id) VALUES (?,?)',
      [canonicalInvestorId, canonicalPortfolioId],
    );
    if (!insert.affectedRows) return { created: false };

    const recipientIds = [
      Number(portfolio.owner_id),
      portfolio.relationship_manager_id != null
        ? Number(portfolio.relationship_manager_id)
        : null,
    ].filter((userId) => userId != null);
    const values = [...new Set(recipientIds)].map((userId) => [
      userId,
      'new_interest',
      'New Investor Interest!',
      `${investorName} is interested in "${portfolio.name}"`,
      canonicalPortfolioId,
      canonicalInvestorId,
    ]);
    await connection.query(
      `INSERT INTO notifications
        (user_id,type,title,body,related_portfolio_id,related_user_id)
       VALUES ?`,
      [values],
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

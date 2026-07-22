const db = require('../config/db');

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

module.exports = { WorkflowError, submitPortfolio, moderatePortfolio, expressInterest };

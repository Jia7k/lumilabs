const defaultDatabase = require('../config/db');

class SuperadminAssignmentError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'SuperadminAssignmentError';
    this.status = status;
    this.code = code;
  }
}

function positiveId(id, label) {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new SuperadminAssignmentError(400, `Invalid ${label}`, 'INVALID_ID');
  }
  return id;
}

function translateDuplicateError(error) {
  if (error instanceof SuperadminAssignmentError) return error;
  if (error && error.code === 'ER_DUP_ENTRY') {
    return new SuperadminAssignmentError(
      409,
      'Portfolio assignment changed concurrently',
      'ASSIGNMENT_CONFLICT',
    );
  }
  return error;
}

async function inTransaction(database, work) {
  const connection = await database.getConnection();
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
        console.error('Assignment rollback failed');
        releaseConnection = false;
        if (typeof connection.destroy === 'function') {
          try {
            await connection.destroy();
          } catch {
            // Preserve only the original safe assignment error.
          }
        }
      }
    }
    throw translateDuplicateError(error);
  } finally {
    if (releaseConnection) connection.release();
  }
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

function assignmentStateError() {
  return new SuperadminAssignmentError(
    409,
    'Portfolio assignment and conversation manager are inconsistent',
    'ASSIGNMENT_STATE_MISMATCH',
  );
}

function assignmentConflict() {
  return new SuperadminAssignmentError(
    409,
    'Portfolio assignment changed concurrently',
    'ASSIGNMENT_CONFLICT',
  );
}

function publicPortfolio(portfolio) {
  return {
    id: Number(portfolio.id),
    name: portfolio.name,
    status: portfolio.status,
  };
}

function publicManager(manager) {
  if (!manager) return null;
  return {
    id: Number(manager.id),
    name: manager.name,
    email: manager.email,
  };
}

async function lockAssignmentState({
  connection,
  superadminId,
  portfolioId,
  relationshipManagerId,
}) {
  const portfolios = await queryRows(
    connection,
    `SELECT p.id,p.name,p.status,p.owner_id,p.relationship_manager_id,
            owner.name AS owner_name,owner.email AS owner_email
       FROM portfolios p
       JOIN users owner ON owner.id=p.owner_id
      WHERE p.id=?
      FOR UPDATE`,
    [portfolioId],
  );
  const portfolio = portfolios[0] || null;

  const conversations = await queryRows(
    connection,
    `SELECT id,portfolio_id,relationship_manager_id,status,archived_reason
       FROM conversations
      WHERE portfolio_id=?
      FOR UPDATE`,
    [portfolioId],
  );
  const conversation = conversations[0] || null;

  const currentManagerId = portfolio && portfolio.relationship_manager_id != null
    ? Number(portfolio.relationship_manager_id)
    : conversation && conversation.relationship_manager_id != null
      ? Number(conversation.relationship_manager_id)
      : relationshipManagerId || superadminId;
  const targetOrCurrentId = relationshipManagerId || currentManagerId;
  const users = await queryRows(
    connection,
    `SELECT id,name,email,role
       FROM users
      WHERE id IN (?,?,?)
      ORDER BY id
      FOR UPDATE`,
    [superadminId, currentManagerId, targetOrCurrentId],
  );

  return {
    portfolio,
    conversations,
    conversation,
    users,
  };
}

function requirePortfolio(portfolio) {
  if (!portfolio) {
    throw new SuperadminAssignmentError(
      404,
      'Portfolio not found',
      'PORTFOLIO_NOT_FOUND',
    );
  }
}

function requireSuperadmin(users, superadminId) {
  const superadmin = users.find((user) => Number(user.id) === superadminId);
  if (!superadmin || superadmin.role !== 'superadmin') {
    throw new SuperadminAssignmentError(
      403,
      'Superadmin access required',
      'SUPERADMIN_REQUIRED',
    );
  }
  return superadmin;
}

function requireRelationshipManager(users, relationshipManagerId) {
  const manager = users.find((user) => Number(user.id) === relationshipManagerId);
  if (!manager || manager.role !== 'relationship_manager') {
    throw new SuperadminAssignmentError(
      400,
      'A relationship manager is required',
      'RELATIONSHIP_MANAGER_REQUIRED',
    );
  }
  return manager;
}

function requireCurrentManager(users, relationshipManagerId) {
  const manager = users.find((user) => Number(user.id) === relationshipManagerId);
  if (!manager || manager.role !== 'relationship_manager') {
    throw assignmentStateError();
  }
  return manager;
}

function validateConversationState(portfolio, conversations) {
  if (conversations.length > 1) throw assignmentStateError();
  const conversation = conversations[0] || null;
  const portfolioManagerId = portfolio.relationship_manager_id == null
    ? null
    : Number(portfolio.relationship_manager_id);
  if (
    conversation
    && (
      portfolioManagerId == null
      || Number(conversation.portfolio_id) !== Number(portfolio.id)
      || Number(conversation.relationship_manager_id) !== portfolioManagerId
    )
  ) {
    throw assignmentStateError();
  }
  return conversation;
}

async function requireOneAffected(queryResult) {
  if (!queryResult || Number(queryResult.affectedRows) !== 1) {
    throw assignmentConflict();
  }
}

async function insertAssignmentAudit({
  connection,
  superadmin,
  action,
  portfolio,
  previousManager,
  newManager,
}) {
  const [result] = await connection.query(
    `INSERT INTO superadmin_audit_logs
      (superadmin_id,
       superadmin_id_snapshot,
       superadmin_name_snapshot,
       superadmin_email_snapshot,
       action,
       portfolio_id,
       portfolio_id_snapshot,
       portfolio_name_snapshot,
       previous_relationship_manager_id,
       previous_relationship_manager_id_snapshot,
       previous_relationship_manager_name_snapshot,
       previous_relationship_manager_email_snapshot,
       new_relationship_manager_id,
       new_relationship_manager_id_snapshot,
       new_relationship_manager_name_snapshot,
       new_relationship_manager_email_snapshot)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      Number(superadmin.id),
      Number(superadmin.id),
      superadmin.name,
      superadmin.email,
      action,
      Number(portfolio.id),
      Number(portfolio.id),
      portfolio.name,
      previousManager ? Number(previousManager.id) : null,
      previousManager ? Number(previousManager.id) : null,
      previousManager ? previousManager.name : null,
      previousManager ? previousManager.email : null,
      newManager ? Number(newManager.id) : null,
      newManager ? Number(newManager.id) : null,
      newManager ? newManager.name : null,
      newManager ? newManager.email : null,
    ],
  );
  await requireOneAffected(result);
}

function notificationText({ action, portfolio, previousManager, newManager }) {
  if (action === 'portfolio_assigned') {
    return {
      title: 'Portfolio Assigned',
      body: `${newManager.name} was assigned to "${portfolio.name}"`,
    };
  }
  if (action === 'portfolio_reassigned') {
    return {
      title: 'Portfolio Reassigned',
      body: `"${portfolio.name}" was reassigned from ${previousManager.name} to ${newManager.name}`,
    };
  }
  return {
    title: 'Portfolio Unassigned',
    body: `${previousManager.name} was unassigned from "${portfolio.name}"`,
  };
}

async function insertAssignmentNotifications({
  connection,
  action,
  portfolio,
  previousManager,
  newManager,
  conversationId,
}) {
  const recipientIds = action === 'portfolio_assigned'
    ? [Number(portfolio.owner_id), Number(newManager.id)]
    : action === 'portfolio_reassigned'
      ? [
        Number(portfolio.owner_id),
        Number(previousManager.id),
        Number(newManager.id),
      ]
      : [Number(portfolio.owner_id), Number(previousManager.id)];
  const recipients = [...new Set(recipientIds)];
  const text = notificationText({
    action,
    portfolio,
    previousManager,
    newManager,
  });
  const relatedUserId = newManager
    ? Number(newManager.id)
    : Number(previousManager.id);
  const values = recipients.map((recipientId) => {
    const removedManager = (
      action === 'portfolio_reassigned'
      && recipientId === Number(previousManager.id)
    );
    return [
      recipientId,
      action,
      text.title,
      text.body,
      Number(portfolio.id),
      removedManager ? null : conversationId,
      relatedUserId,
    ];
  });
  const [result] = await connection.query(
    `INSERT INTO notifications
      (user_id,type,title,body,related_portfolio_id,related_conversation_id,related_user_id)
     VALUES ?`,
    [values],
  );
  if (!result || Number(result.affectedRows) !== values.length) {
    throw assignmentConflict();
  }
}

function assignmentResult({
  changed,
  action,
  portfolio,
  previousManager,
  newManager,
  conversation,
}) {
  return {
    changed,
    action,
    portfolio: publicPortfolio(portfolio),
    previous_relationship_manager: publicManager(previousManager),
    relationship_manager: publicManager(newManager),
    conversation_id: conversation ? Number(conversation.id) : null,
  };
}

async function updatePortfolioAssignment(connection, portfolio, newManagerId) {
  const [result] = await connection.query(
    `UPDATE portfolios
        SET relationship_manager_id=?
      WHERE id=? AND relationship_manager_id <=> ?`,
    [
      newManagerId,
      Number(portfolio.id),
      portfolio.relationship_manager_id == null
        ? null
        : Number(portfolio.relationship_manager_id),
    ],
  );
  await requireOneAffected(result);
}

async function requireSoleActiveManager(connection, conversationId, managerId) {
  const managerMemberships = await queryRows(
    connection,
    `SELECT user_id,membership_status
       FROM conversation_members
      WHERE conversation_id=?
        AND member_role='relationship_manager'
      ORDER BY user_id
      FOR UPDATE`,
    [conversationId],
  );
  const activeManagers = managerMemberships.filter(
    (member) => member.membership_status === 'active',
  );
  if (
    activeManagers.length !== 1
    || Number(activeManagers[0].user_id) !== managerId
  ) {
    throw assignmentStateError();
  }
}

async function reassignConversation({
  connection,
  portfolio,
  conversation,
  previousManager,
  newManager,
}) {
  let result;
  [result] = await connection.query(
    `UPDATE conversation_members
        SET membership_status='removed',left_at=CURRENT_TIMESTAMP
      WHERE conversation_id=? AND user_id=? AND member_role='relationship_manager'
        AND membership_status='active'`,
    [Number(conversation.id), Number(previousManager.id)],
  );
  if (!result || Number(result.affectedRows) !== 1) throw assignmentStateError();

  [result] = await connection.query(
    `INSERT INTO conversation_members
      (conversation_id,user_id,member_role,membership_status,
       visible_after_message_id,joined_at,left_at,last_read_message_id)
     VALUES (?,?,'relationship_manager','active',0,CURRENT_TIMESTAMP,NULL,0)
     ON DUPLICATE KEY UPDATE
       member_role='relationship_manager',
       membership_status='active',
       visible_after_message_id=0,
       joined_at=CURRENT_TIMESTAMP,
       left_at=NULL`,
    [Number(conversation.id), Number(newManager.id)],
  );
  if (!result || Number(result.affectedRows) < 1) throw assignmentStateError();

  [result] = await connection.query(
    'UPDATE conversations SET relationship_manager_id=? WHERE id=?',
    [Number(newManager.id), Number(conversation.id)],
  );
  await requireOneAffected(result);

  [result] = await connection.query(
    'UPDATE portfolios SET relationship_manager_id=? WHERE id=?',
    [Number(newManager.id), Number(portfolio.id)],
  );
  await requireOneAffected(result);

  await requireSoleActiveManager(
    connection,
    Number(conversation.id),
    Number(newManager.id),
  );
}

async function assignPortfolio({
  database = defaultDatabase,
  superadminId: superadminIdValue,
  portfolioId: portfolioIdValue,
  relationshipManagerId: relationshipManagerIdValue,
}) {
  const superadminId = positiveId(superadminIdValue, 'superadmin ID');
  const portfolioId = positiveId(portfolioIdValue, 'portfolio ID');
  const relationshipManagerId = positiveId(
    relationshipManagerIdValue,
    'relationship manager ID',
  );

  return inTransaction(database, async (connection) => {
    const locked = await lockAssignmentState({
      connection,
      superadminId,
      portfolioId,
      relationshipManagerId,
    });
    requirePortfolio(locked.portfolio);
    const superadmin = requireSuperadmin(locked.users, superadminId);
    const newManager = requireRelationshipManager(
      locked.users,
      relationshipManagerId,
    );
    const conversation = validateConversationState(
      locked.portfolio,
      locked.conversations,
    );
    const previousManagerId = locked.portfolio.relationship_manager_id == null
      ? null
      : Number(locked.portfolio.relationship_manager_id);
    const previousManager = previousManagerId == null
      ? null
      : requireCurrentManager(locked.users, previousManagerId);

    if (previousManagerId === relationshipManagerId) {
      if (conversation) {
        await requireSoleActiveManager(
          connection,
          Number(conversation.id),
          relationshipManagerId,
        );
      }
      return assignmentResult({
        changed: false,
        action: null,
        portfolio: locked.portfolio,
        previousManager,
        newManager,
        conversation,
      });
    }
    if (locked.portfolio.status !== 'approved') {
      throw new SuperadminAssignmentError(
        409,
        'Only approved portfolios can be assigned',
        'PORTFOLIO_NOT_APPROVED',
      );
    }

    const action = previousManager
      ? 'portfolio_reassigned'
      : 'portfolio_assigned';
    if (conversation) {
      await reassignConversation({
        connection,
        portfolio: locked.portfolio,
        conversation,
        previousManager,
        newManager,
      });
    } else {
      await updatePortfolioAssignment(
        connection,
        locked.portfolio,
        relationshipManagerId,
      );
    }
    await insertAssignmentAudit({
      connection,
      superadmin,
      action,
      portfolio: locked.portfolio,
      previousManager,
      newManager,
    });
    await insertAssignmentNotifications({
      connection,
      action,
      portfolio: locked.portfolio,
      previousManager,
      newManager,
      conversationId: conversation ? Number(conversation.id) : null,
    });

    return assignmentResult({
      changed: true,
      action,
      portfolio: locked.portfolio,
      previousManager,
      newManager,
      conversation,
    });
  });
}

async function unassignPortfolio({
  database = defaultDatabase,
  superadminId: superadminIdValue,
  portfolioId: portfolioIdValue,
}) {
  const superadminId = positiveId(superadminIdValue, 'superadmin ID');
  const portfolioId = positiveId(portfolioIdValue, 'portfolio ID');

  return inTransaction(database, async (connection) => {
    const locked = await lockAssignmentState({
      connection,
      superadminId,
      portfolioId,
      relationshipManagerId: null,
    });
    requirePortfolio(locked.portfolio);
    const superadmin = requireSuperadmin(locked.users, superadminId);
    if (locked.conversations.length) {
      throw new SuperadminAssignmentError(
        409,
        'Reassign required because this portfolio already has a chat',
        'CONVERSATION_REQUIRES_REASSIGNMENT',
      );
    }

    const previousManagerId = locked.portfolio.relationship_manager_id == null
      ? null
      : Number(locked.portfolio.relationship_manager_id);
    if (previousManagerId == null) {
      return assignmentResult({
        changed: false,
        action: null,
        portfolio: locked.portfolio,
        previousManager: null,
        newManager: null,
        conversation: null,
      });
    }
    const previousManager = requireCurrentManager(
      locked.users,
      previousManagerId,
    );
    let result;
    [result] = await connection.query(
      `UPDATE portfolios
          SET relationship_manager_id=NULL
        WHERE id=? AND relationship_manager_id <=> ?`,
      [portfolioId, previousManagerId],
    );
    await requireOneAffected(result);

    const action = 'portfolio_unassigned';
    await insertAssignmentAudit({
      connection,
      superadmin,
      action,
      portfolio: locked.portfolio,
      previousManager,
      newManager: null,
    });
    await insertAssignmentNotifications({
      connection,
      action,
      portfolio: locked.portfolio,
      previousManager,
      newManager: null,
      conversationId: null,
    });

    return assignmentResult({
      changed: true,
      action,
      portfolio: locked.portfolio,
      previousManager,
      newManager: null,
      conversation: null,
    });
  });
}

module.exports = {
  SuperadminAssignmentError,
  assignPortfolio,
  unassignPortfolio,
};

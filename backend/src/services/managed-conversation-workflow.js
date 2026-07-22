const defaultDatabase = require('../config/db');

class ManagedConversationError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ManagedConversationError(400, `Invalid ${label}`, 'INVALID_ID');
  }
  return id;
}

function uniqueInterestIds(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ManagedConversationError(
      400,
      'Select at least one investor interest',
      'EMPTY_INTERESTS',
    );
  }
  return [...new Set(values.map((value) => positiveId(value, 'interest ID')))];
}

async function inTransaction(database, work) {
  const connection = await database.getConnection();
  let transactionOpen = false;
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
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

function assertInterestsFound(requestedIds, interestRows) {
  const found = new Set(interestRows.map((row) => Number(row.interest_id)));
  if (requestedIds.some((id) => !found.has(id)) || found.size !== requestedIds.length) {
    throw new ManagedConversationError(
      409,
      'One or more investor interests are no longer eligible',
      'INELIGIBLE_INTEREST',
    );
  }
}

async function loadParticipants(connection, conversationId) {
  const participants = await queryRows(
    connection,
    `SELECT u.id, u.name, cm.member_role AS role
       FROM conversation_members cm
       JOIN users u ON u.id=cm.user_id
      WHERE cm.conversation_id=? AND cm.membership_status='active'
      ORDER BY FIELD(cm.member_role,'relationship_manager','business_owner','investor'),
               u.name, u.id`,
    [conversationId],
  );
  return participants.map((participant) => ({
    id: Number(participant.id),
    name: participant.name,
    role: participant.role,
  }));
}

function creationNotifications({ recipients, portfolio, conversationId, manager }) {
  return recipients.map((userId) => [
    userId,
    'conversation_created',
    'Managed Conversation Created',
    `${manager.name} created the managed conversation for "${portfolio.name}"`,
    portfolio.id,
    conversationId,
    manager.id,
  ]);
}

async function createManagedConversation({
  database = defaultDatabase,
  managerId: managerIdValue,
  portfolioId: portfolioIdValue,
  interestIds: interestIdValues,
}) {
  const managerId = positiveId(managerIdValue, 'manager ID');
  const portfolioId = positiveId(portfolioIdValue, 'portfolio ID');
  const interestIds = uniqueInterestIds(interestIdValues);

  return inTransaction(database, async (connection) => {
    const managers = await queryRows(
      connection,
      'SELECT id,name,role FROM users WHERE id=? FOR UPDATE',
      [managerId],
    );
    const manager = managers[0];
    if (!manager || manager.role !== 'relationship_manager') {
      throw new ManagedConversationError(
        403,
        'Relationship manager access required',
        'MANAGER_ROLE_REQUIRED',
      );
    }

    const portfolios = await queryRows(
      connection,
      `SELECT p.id,p.owner_id,p.name,p.status,u.name AS owner_name
         FROM portfolios p
         JOIN users u ON u.id=p.owner_id
        WHERE p.id=?
        FOR UPDATE`,
      [portfolioId],
    );
    const portfolio = portfolios[0];
    if (!portfolio) {
      throw new ManagedConversationError(404, 'Portfolio not found', 'PORTFOLIO_NOT_FOUND');
    }
    if (portfolio.status !== 'approved') {
      throw new ManagedConversationError(
        409,
        'Only approved portfolios can have an active conversation',
        'PORTFOLIO_NOT_APPROVED',
      );
    }

    const existing = await queryRows(
      connection,
      'SELECT id,relationship_manager_id FROM conversations WHERE portfolio_id=? FOR UPDATE',
      [portfolioId],
    );
    if (existing.length) {
      throw new ManagedConversationError(
        409,
        'This portfolio already has a managed conversation',
        'ROOM_ALREADY_CLAIMED',
      );
    }

    const placeholders = interestIds.map(() => '?').join(',');
    const interests = await queryRows(
      connection,
      `SELECT ii.id AS interest_id,ii.investor_id,u.name AS investor_name
         FROM investor_interests ii
         JOIN users u ON u.id=ii.investor_id AND u.role='investor'
        WHERE ii.portfolio_id=? AND ii.id IN (${placeholders})
        ORDER BY ii.id
        FOR UPDATE`,
      [portfolioId, ...interestIds],
    );
    assertInterestsFound(interestIds, interests);

    let inserted;
    try {
      [inserted] = await connection.query(
        `INSERT INTO conversations
          (portfolio_id,relationship_manager_id,title,status)
         VALUES (?,?,?,'active')`,
        [portfolioId, managerId, portfolio.name],
      );
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new ManagedConversationError(
          409,
          'This portfolio already has a managed conversation',
          'ROOM_ALREADY_CLAIMED',
        );
      }
      throw error;
    }
    const conversationId = Number(inserted.insertId);
    const membershipValues = [
      [conversationId, managerId, 'relationship_manager', 0, 0],
      [conversationId, Number(portfolio.owner_id), 'business_owner', 0, 0],
      ...interests.map((interest) => [
        conversationId,
        Number(interest.investor_id),
        'investor',
        0,
        0,
      ]),
    ];
    await connection.query(
      `INSERT INTO conversation_members
        (conversation_id,user_id,member_role,visible_after_message_id,last_read_message_id)
       VALUES ?`,
      [membershipValues],
    );

    const recipients = [
      Number(portfolio.owner_id),
      ...interests.map((interest) => Number(interest.investor_id)),
    ];
    await connection.query(
      `INSERT INTO notifications
        (user_id,type,title,body,related_portfolio_id,related_conversation_id,related_user_id)
       VALUES ?`,
      [creationNotifications({
        recipients,
        portfolio,
        conversationId,
        manager: { id: managerId, name: manager.name },
      })],
    );

    return {
      conversation_id: conversationId,
      portfolio_id: portfolioId,
      title: portfolio.name,
      status: 'active',
      archived_reason: null,
      owner: { id: Number(portfolio.owner_id), name: portfolio.owner_name },
      manager: { id: managerId, name: manager.name },
      investors: interests.map((interest) => ({
        id: Number(interest.investor_id),
        name: interest.investor_name,
        interest_id: Number(interest.interest_id),
      })),
    };
  });
}

async function loadManagedConversation(connection, conversationId) {
  const conversations = await queryRows(
    connection,
    `SELECT c.id,c.portfolio_id,c.relationship_manager_id,c.title,c.status,
            c.archived_reason,p.status AS portfolio_status
       FROM conversations c
       LEFT JOIN portfolios p ON p.id=c.portfolio_id
      WHERE c.id=?
      FOR UPDATE`,
    [conversationId],
  );
  if (!conversations.length) {
    throw new ManagedConversationError(404, 'Conversation not found', 'ROOM_NOT_FOUND');
  }
  return conversations[0];
}

function assertAssignedManager(conversation, managerId) {
  if (Number(conversation.relationship_manager_id) !== managerId) {
    throw new ManagedConversationError(
      403,
      'Only the assigned relationship manager can manage this conversation',
      'NOT_ASSIGNED_MANAGER',
    );
  }
}

async function loadEligibleInterests(connection, portfolioId, interestIds) {
  const placeholders = interestIds.map(() => '?').join(',');
  const interests = await queryRows(
    connection,
    `SELECT ii.id AS interest_id,ii.investor_id,u.name AS investor_name
       FROM investor_interests ii
       JOIN users u ON u.id=ii.investor_id AND u.role='investor'
      WHERE ii.portfolio_id=? AND ii.id IN (${placeholders})
      ORDER BY ii.id
      FOR UPDATE`,
    [portfolioId, ...interestIds],
  );
  assertInterestsFound(interestIds, interests);
  return interests;
}

async function addManagedInvestors({
  database = defaultDatabase,
  managerId: managerIdValue,
  conversationId: conversationIdValue,
  interestIds: interestIdValues,
}) {
  const managerId = positiveId(managerIdValue, 'manager ID');
  const conversationId = positiveId(conversationIdValue, 'conversation ID');
  const interestIds = uniqueInterestIds(interestIdValues);

  return inTransaction(database, async (connection) => {
    const conversation = await loadManagedConversation(connection, conversationId);
    assertAssignedManager(conversation, managerId);
    if (!conversation.portfolio_id || conversation.portfolio_status !== 'approved') {
      throw new ManagedConversationError(
        409,
        'Investors can only be added while the portfolio is approved',
        'PORTFOLIO_NOT_APPROVED',
      );
    }
    const portfolioId = Number(conversation.portfolio_id);
    const interests = await loadEligibleInterests(
      connection,
      portfolioId,
      interestIds,
    );
    const investorIds = interests.map((interest) => Number(interest.investor_id));
    const placeholders = investorIds.map(() => '?').join(',');
    const memberships = await queryRows(
      connection,
      `SELECT user_id,membership_status
         FROM conversation_members
        WHERE conversation_id=? AND user_id IN (${placeholders})
        FOR UPDATE`,
      [conversationId, ...investorIds],
    );
    const membershipByUser = new Map(
      memberships.map((membership) => [Number(membership.user_id), membership]),
    );
    const changedInvestorIds = investorIds.filter((investorId) => (
      membershipByUser.get(investorId)?.membership_status !== 'active'
    ));

    if (changedInvestorIds.length) {
      const latestRows = await queryRows(
        connection,
        'SELECT COALESCE(MAX(id),0) AS latest_message_id FROM messages WHERE conversation_id=?',
        [conversationId],
      );
      const boundary = Number(latestRows[0]?.latest_message_id || 0);
      const activeBefore = await queryRows(
        connection,
        `SELECT user_id,member_role
           FROM conversation_members
          WHERE conversation_id=? AND membership_status='active'
          FOR UPDATE`,
        [conversationId],
      );

      const absent = changedInvestorIds.filter((investorId) => !membershipByUser.has(investorId));
      if (absent.length) {
        const values = absent.map((investorId) => [
          conversationId,
          investorId,
          'investor',
          'active',
          boundary,
          boundary,
        ]);
        await connection.query(
          `INSERT INTO conversation_members
            (conversation_id,user_id,member_role,membership_status,
             visible_after_message_id,last_read_message_id)
           VALUES ?`,
          [values],
        );
      }

      const removed = changedInvestorIds.filter((investorId) => membershipByUser.has(investorId));
      for (const investorId of removed) {
        await connection.query(
          `UPDATE conversation_members
              SET membership_status='active',joined_at=NOW(),left_at=NULL,
                  visible_after_message_id=?,last_read_message_id=?
            WHERE conversation_id=? AND user_id=? AND member_role='investor'`,
          [boundary, boundary, conversationId, investorId],
        );
      }

      const recipients = [...new Set([
        ...changedInvestorIds,
        ...activeBefore
          .map((membership) => Number(membership.user_id))
          .filter((userId) => userId !== managerId),
      ])];
      if (recipients.length) {
        const values = recipients.map((userId) => [
          userId,
          'conversation_member_added',
          'Investor Added to Conversation',
          `An eligible investor was added to the managed conversation for "${conversation.title}"`,
          portfolioId,
          conversationId,
          managerId,
        ]);
        await connection.query(
          `INSERT INTO notifications
            (user_id,type,title,body,related_portfolio_id,related_conversation_id,related_user_id)
           VALUES ?`,
          [values],
        );
      }
    }

    return {
      conversation_id: conversationId,
      added_investor_ids: changedInvestorIds,
      participants: await loadParticipants(connection, conversationId),
    };
  });
}

async function archiveManagedConversation({
  database = defaultDatabase,
  managerId: managerIdValue,
  conversationId: conversationIdValue,
}) {
  const managerId = positiveId(managerIdValue, 'manager ID');
  const conversationId = positiveId(conversationIdValue, 'conversation ID');
  return inTransaction(database, async (connection) => {
    const conversation = await loadManagedConversation(connection, conversationId);
    assertAssignedManager(conversation, managerId);
    if (conversation.status === 'archived') {
      return {
        conversation_id: conversationId,
        status: 'archived',
        archived_reason: conversation.archived_reason,
        changed: false,
      };
    }

    const activeMembers = await queryRows(
      connection,
      `SELECT user_id
         FROM conversation_members
        WHERE conversation_id=? AND membership_status='active'
        FOR UPDATE`,
      [conversationId],
    );
    await connection.query(
      `UPDATE conversations
          SET status='archived',archived_reason='manual'
        WHERE id=?`,
      [conversationId],
    );
    const recipients = activeMembers
      .map((membership) => Number(membership.user_id))
      .filter((userId) => userId !== managerId);
    if (recipients.length) {
      const values = recipients.map((userId) => [
        userId,
        'conversation_archived',
        'Conversation Archived',
        `The managed conversation for "${conversation.title}" is now read-only`,
        conversation.portfolio_id ? Number(conversation.portfolio_id) : null,
        conversationId,
        managerId,
      ]);
      await connection.query(
        `INSERT INTO notifications
          (user_id,type,title,body,related_portfolio_id,related_conversation_id,related_user_id)
         VALUES ?`,
        [values],
      );
    }
    return {
      conversation_id: conversationId,
      status: 'archived',
      archived_reason: 'manual',
      changed: true,
    };
  });
}

async function reopenManagedConversation({
  database = defaultDatabase,
  managerId: managerIdValue,
  conversationId: conversationIdValue,
}) {
  const managerId = positiveId(managerIdValue, 'manager ID');
  const conversationId = positiveId(conversationIdValue, 'conversation ID');
  return inTransaction(database, async (connection) => {
    const conversation = await loadManagedConversation(connection, conversationId);
    assertAssignedManager(conversation, managerId);
    if (conversation.status === 'active') {
      return {
        conversation_id: conversationId,
        status: 'active',
        archived_reason: null,
        changed: false,
      };
    }
    if (!conversation.portfolio_id || conversation.portfolio_status !== 'approved') {
      throw new ManagedConversationError(
        409,
        'This conversation cannot reopen without an approved portfolio',
        'PORTFOLIO_NOT_APPROVED',
      );
    }
    const eligibleRows = await queryRows(
      connection,
      `SELECT COUNT(*) AS eligible_count
         FROM conversation_members cm
         JOIN investor_interests ii
           ON ii.investor_id=cm.user_id AND ii.portfolio_id=?
        WHERE cm.conversation_id=?
          AND cm.member_role='investor'
          AND cm.membership_status='active'
        FOR UPDATE`,
      [conversation.portfolio_id, conversationId],
    );
    if (Number(eligibleRows[0]?.eligible_count || 0) < 1) {
      throw new ManagedConversationError(
        409,
        'At least one active eligible investor is required to reopen',
        'NO_ELIGIBLE_INVESTOR',
      );
    }
    await connection.query(
      "UPDATE conversations SET status='active',archived_reason=NULL WHERE id=?",
      [conversationId],
    );
    return {
      conversation_id: conversationId,
      status: 'active',
      archived_reason: null,
      changed: true,
    };
  });
}

const AUTOMATIC_ARCHIVE_REASONS = new Set([
  'no_active_investors',
  'portfolio_unapproved',
  'portfolio_deleted',
]);

async function loadConversationForPortfolio(connection, portfolioId) {
  const conversations = await queryRows(
    connection,
    `SELECT id,portfolio_id,title,status,archived_reason
       FROM conversations
      WHERE portfolio_id=?
      FOR UPDATE`,
    [portfolioId],
  );
  return conversations[0] || null;
}

function automaticReasonShouldReplace(conversation, reason) {
  if (conversation.status !== 'archived') return true;
  if (conversation.archived_reason === reason) return false;
  if (reason === 'portfolio_deleted') return true;
  return !conversation.archived_reason || conversation.archived_reason === 'manual';
}

async function applyAutomaticArchive(connection, conversation, reason, actorId) {
  if (!automaticReasonShouldReplace(conversation, reason)) {
    return { conversationId: Number(conversation.id), changed: false };
  }
  const activeMembers = await queryRows(
    connection,
    `SELECT user_id
       FROM conversation_members
      WHERE conversation_id=? AND membership_status='active'
      FOR UPDATE`,
    [conversation.id],
  );
  await connection.query(
    `UPDATE conversations
        SET status='archived',archived_reason=?
      WHERE id=?`,
    [reason, conversation.id],
  );
  const recipients = activeMembers
    .map((membership) => Number(membership.user_id))
    .filter((userId) => userId !== Number(actorId));
  if (recipients.length) {
    const values = recipients.map((userId) => [
      userId,
      'conversation_archived',
      'Conversation Archived',
      `The managed conversation for "${conversation.title}" is now read-only`,
      conversation.portfolio_id ? Number(conversation.portfolio_id) : null,
      Number(conversation.id),
      Number(actorId),
    ]);
    await connection.query(
      `INSERT INTO notifications
        (user_id,type,title,body,related_portfolio_id,related_conversation_id,related_user_id)
       VALUES ?`,
      [values],
    );
  }
  return { conversationId: Number(conversation.id), changed: true };
}

async function archiveConversationForPortfolio(
  connection,
  portfolioIdValue,
  reason,
  actorIdValue,
) {
  const portfolioId = positiveId(portfolioIdValue, 'portfolio ID');
  const actorId = positiveId(actorIdValue, 'actor ID');
  if (!AUTOMATIC_ARCHIVE_REASONS.has(reason)) {
    throw new ManagedConversationError(
      400,
      'Invalid automatic archive reason',
      'INVALID_ARCHIVE_REASON',
    );
  }
  const conversation = await loadConversationForPortfolio(connection, portfolioId);
  if (!conversation) return { conversationId: null, changed: false };
  return applyAutomaticArchive(connection, conversation, reason, actorId);
}

async function withdrawInvestorInterest({
  database = defaultDatabase,
  investorId: investorIdValue,
  portfolioId: portfolioIdValue,
}) {
  const investorId = positiveId(investorIdValue, 'investor ID');
  const portfolioId = positiveId(portfolioIdValue, 'portfolio ID');
  return inTransaction(database, async (connection) => {
    const interests = await queryRows(
      connection,
      `SELECT id,investor_id,portfolio_id
         FROM investor_interests
        WHERE investor_id=? AND portfolio_id=?
        FOR UPDATE`,
      [investorId, portfolioId],
    );
    if (!interests.length) {
      throw new ManagedConversationError(404, 'Interest not found', 'INTEREST_NOT_FOUND');
    }

    const conversation = await loadConversationForPortfolio(connection, portfolioId);
    if (!conversation) {
      await connection.query('DELETE FROM investor_interests WHERE id=?', [interests[0].id]);
      return { removed: true, conversation_id: null, archived: false };
    }

    const memberships = await queryRows(
      connection,
      `SELECT user_id,membership_status
         FROM conversation_members
        WHERE conversation_id=? AND user_id=? AND member_role='investor'
        FOR UPDATE`,
      [conversation.id, investorId],
    );
    if (memberships[0]?.membership_status === 'active') {
      await connection.query(
        `UPDATE conversation_members
            SET membership_status='removed',left_at=NOW()
          WHERE conversation_id=? AND user_id=? AND member_role='investor'`,
        [conversation.id, investorId],
      );
    }
    await connection.query(
      'DELETE FROM notifications WHERE related_conversation_id=? AND user_id=?',
      [conversation.id, investorId],
    );
    await connection.query('DELETE FROM investor_interests WHERE id=?', [interests[0].id]);
    const activeRows = await queryRows(
      connection,
      `SELECT COUNT(*) AS active_count
         FROM conversation_members
        WHERE conversation_id=?
          AND member_role='investor'
          AND membership_status='active'`,
      [conversation.id],
    );
    const noActiveInvestors = Number(activeRows[0]?.active_count || 0) === 0;
    if (noActiveInvestors) {
      await applyAutomaticArchive(
        connection,
        conversation,
        'no_active_investors',
        investorId,
      );
    }
    return {
      removed: true,
      conversation_id: Number(conversation.id),
      archived: noActiveInvestors,
    };
  });
}

async function prepareConversationForPortfolioDeletion(
  connection,
  portfolioIdValue,
  actorIdValue,
) {
  const portfolioId = positiveId(portfolioIdValue, 'portfolio ID');
  const actorId = positiveId(actorIdValue, 'actor ID');
  const conversation = await loadConversationForPortfolio(connection, portfolioId);
  if (!conversation) return { conversationId: null, changed: false };

  const archive = await applyAutomaticArchive(
    connection,
    conversation,
    'portfolio_deleted',
    actorId,
  );
  const investorMembers = await queryRows(
    connection,
    `SELECT user_id
       FROM conversation_members
      WHERE conversation_id=? AND member_role='investor'
      FOR UPDATE`,
    [conversation.id],
  );
  const investorIds = investorMembers.map((member) => Number(member.user_id));
  if (investorIds.length) {
    const placeholders = investorIds.map(() => '?').join(',');
    await connection.query(
      `DELETE FROM notifications
        WHERE related_conversation_id=? AND user_id IN (${placeholders})`,
      [conversation.id, ...investorIds],
    );
    await connection.query(
      `UPDATE conversation_members
          SET membership_status='removed',left_at=COALESCE(left_at,NOW())
        WHERE conversation_id=? AND member_role='investor'`,
      [conversation.id],
    );
  }
  await connection.query(
    'UPDATE conversations SET portfolio_id=NULL WHERE id=?',
    [conversation.id],
  );
  return archive;
}

module.exports = {
  ManagedConversationError,
  addManagedInvestors,
  archiveConversationForPortfolio,
  archiveManagedConversation,
  createManagedConversation,
  prepareConversationForPortfolioDeletion,
  reopenManagedConversation,
  withdrawInvestorInterest,
};

const defaultDatabase = require('../config/db');

class ManagedConversationError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'ManagedConversationError';
    this.status = status;
    this.code = code;
  }
}

const ARCHIVE_PRIORITY = Object.freeze({
  manual: 0,
  no_active_investors: 1,
  portfolio_unapproved: 2,
  portfolio_deleted: 3,
});

const AUTOMATIC_ARCHIVE_REASONS = new Set([
  'no_active_investors',
  'portfolio_unapproved',
  'portfolio_deleted',
]);

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
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
        console.error('Managed conversation rollback failed');
        releaseConnection = false;
        if (typeof connection.destroy === 'function') {
          try {
            await connection.destroy();
          } catch {
            // The original workflow error remains the only public failure.
          }
        }
      }
    }
    throw error;
  } finally {
    if (releaseConnection) connection.release();
  }
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

async function insertNotifications(connection, values) {
  if (!values.length) return;
  await connection.query(
    `INSERT INTO notifications
      (user_id,type,title,body,related_portfolio_id,related_conversation_id,related_user_id)
     VALUES ?`,
    [values],
  );
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

async function lockPortfolio(connection, portfolioId) {
  const portfolios = await queryRows(
    connection,
    `SELECT p.id,p.owner_id,p.name,p.status,p.relationship_manager_id,
            owner.name AS owner_name
       FROM portfolios p
       JOIN users owner ON owner.id=p.owner_id
      WHERE p.id=?
      FOR UPDATE`,
    [portfolioId],
  );
  if (!portfolios.length) {
    throw new ManagedConversationError(404, 'Portfolio not found', 'PORTFOLIO_NOT_FOUND');
  }
  return portfolios[0];
}

async function lockManager(connection, managerId) {
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
  return manager;
}

function assertCanonicalAssignment(portfolio, conversation, managerId) {
  if (
    Number(portfolio.relationship_manager_id) !== managerId
    || (conversation && Number(conversation.relationship_manager_id) !== managerId)
  ) {
    throw new ManagedConversationError(
      403,
      'Only the assigned relationship manager can manage this conversation',
      'NOT_ASSIGNED_MANAGER',
    );
  }
}

function assertConsistentAssignment(portfolio, conversation) {
  if (
    conversation
    && (
      portfolio.relationship_manager_id == null
      || Number(conversation.relationship_manager_id)
        !== Number(portfolio.relationship_manager_id)
    )
  ) {
    throw new ManagedConversationError(
      409,
      'Portfolio assignment and conversation manager are inconsistent',
      'ASSIGNMENT_STATE_MISMATCH',
    );
  }
}

function assertApprovedPortfolio(portfolio, actionMessage) {
  if (portfolio.status !== 'approved') {
    throw new ManagedConversationError(
      409,
      actionMessage,
      'PORTFOLIO_NOT_APPROVED',
    );
  }
}

async function loadConversationReference(connection, conversationId) {
  const rows = await queryRows(
    connection,
    'SELECT id,portfolio_id FROM conversations WHERE id=?',
    [conversationId],
  );
  if (!rows.length || rows[0].portfolio_id == null) {
    throw new ManagedConversationError(404, 'Conversation not found', 'ROOM_NOT_FOUND');
  }
  return rows[0];
}

async function lockConversationById(connection, conversationId, portfolioId) {
  const rows = await queryRows(
    connection,
    `SELECT id,portfolio_id,relationship_manager_id,title,status,archived_reason
       FROM conversations
      WHERE id=? AND portfolio_id=?
      FOR UPDATE`,
    [conversationId, portfolioId],
  );
  if (!rows.length) {
    throw new ManagedConversationError(404, 'Conversation not found', 'ROOM_NOT_FOUND');
  }
  return rows[0];
}

async function lockManagedContext(connection, conversationId, managerId) {
  const reference = await loadConversationReference(connection, conversationId);
  const portfolioId = Number(reference.portfolio_id);
  const portfolio = await lockPortfolio(connection, portfolioId);
  assertCanonicalAssignment(portfolio, null, managerId);
  const conversation = await lockConversationById(
    connection,
    conversationId,
    portfolioId,
  );
  assertCanonicalAssignment(portfolio, conversation, managerId);
  await lockManager(connection, managerId);
  return { portfolio, conversation };
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

async function loadParticipants(connection, conversationId) {
  const participants = await queryRows(
    connection,
    `SELECT u.id,u.name,cm.member_role AS role
       FROM conversation_members cm
       JOIN users u ON u.id=cm.user_id
      WHERE cm.conversation_id=? AND cm.membership_status='active'
      ORDER BY FIELD(cm.member_role,'relationship_manager','business_owner','investor'),
               u.name,u.id`,
    [conversationId],
  );
  return participants.map((participant) => ({
    id: Number(participant.id),
    name: participant.name,
    role: participant.role,
  }));
}

function creationNotificationValues({
  recipients,
  portfolio,
  conversationId,
  manager,
}) {
  return [...new Set(recipients)].map((userId) => [
    userId,
    'conversation_created',
    'Managed Conversation Created',
    `${manager.name} created the managed conversation for "${portfolio.name}"`,
    Number(portfolio.id),
    conversationId,
    Number(manager.id),
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
    const portfolio = await lockPortfolio(connection, portfolioId);
    assertCanonicalAssignment(portfolio, null, managerId);
    assertApprovedPortfolio(
      portfolio,
      'Portfolio must be approved before creating a chat',
    );

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

    const manager = await lockManager(connection, managerId);
    const interests = await loadEligibleInterests(
      connection,
      portfolioId,
      interestIds,
    );

    let inserted;
    try {
      [inserted] = await connection.query(
        `INSERT INTO conversations
          (portfolio_id,relationship_manager_id,title,status)
         VALUES (?,?,?,'active')`,
        [portfolioId, managerId, portfolio.name],
      );
    } catch (error) {
      if (error && error.code === 'ER_DUP_ENTRY') {
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

    await insertNotifications(
      connection,
      creationNotificationValues({
        recipients: [
          Number(portfolio.owner_id),
          ...interests.map((interest) => Number(interest.investor_id)),
        ],
        portfolio,
        conversationId,
        manager,
      }),
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
    const { portfolio, conversation } = await lockManagedContext(
      connection,
      conversationId,
      managerId,
    );
    assertApprovedPortfolio(
      portfolio,
      'Investors can only be added while the portfolio is approved',
    );

    const portfolioId = Number(portfolio.id);
    const interests = await loadEligibleInterests(
      connection,
      portfolioId,
      interestIds,
    );
    const investorIds = interests.map((interest) => Number(interest.investor_id));
    const placeholders = investorIds.map(() => '?').join(',');
    const memberships = await queryRows(
      connection,
      `SELECT user_id,member_role,membership_status
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

      const absent = changedInvestorIds.filter((investorId) => (
        !membershipByUser.has(investorId)
      ));
      if (absent.length) {
        await connection.query(
          `INSERT INTO conversation_members
            (conversation_id,user_id,member_role,membership_status,
             visible_after_message_id,last_read_message_id)
           VALUES ?`,
          [absent.map((investorId) => [
            conversationId,
            investorId,
            'investor',
            'active',
            boundary,
            boundary,
          ])],
        );
      }

      const removed = changedInvestorIds.filter((investorId) => (
        membershipByUser.has(investorId)
      ));
      for (const investorId of removed) {
        await connection.query(
          `UPDATE conversation_members
              SET membership_status='active',joined_at=NOW(),left_at=NULL,
                  visible_after_message_id=?,last_read_message_id=?
            WHERE conversation_id=? AND user_id=? AND member_role='investor'
              AND membership_status='removed'`,
          [boundary, boundary, conversationId, investorId],
        );
      }

      if (
        conversation.status === 'archived'
        && conversation.archived_reason === 'no_active_investors'
      ) {
        await connection.query(
          `UPDATE conversations
              SET status='active',archived_reason=NULL
            WHERE id=? AND status='archived'
              AND archived_reason='no_active_investors'`,
          [conversationId],
        );
      }

      const recipients = [...new Set([
        ...changedInvestorIds,
        ...activeBefore
          .map((membership) => Number(membership.user_id))
          .filter((userId) => userId !== managerId),
      ])];
      await insertNotifications(
        connection,
        recipients.map((userId) => [
          userId,
          'conversation_member_added',
          'Investor Added to Conversation',
          `An eligible investor was added to the managed conversation for "${conversation.title}"`,
          portfolioId,
          conversationId,
          managerId,
        ]),
      );
    }

    return {
      conversation_id: conversationId,
      added_investor_ids: changedInvestorIds,
      participants: await loadParticipants(connection, conversationId),
    };
  });
}

function shouldReplaceArchiveReason(current, next) {
  if (!current) return true;
  return ARCHIVE_PRIORITY[next] > ARCHIVE_PRIORITY[current];
}

async function loadConversationForPortfolio(connection, portfolioId) {
  const conversations = await queryRows(
    connection,
    `SELECT id,portfolio_id,relationship_manager_id,title,status,archived_reason
       FROM conversations
      WHERE portfolio_id=?
      FOR UPDATE`,
    [portfolioId],
  );
  return conversations[0] || null;
}

async function lockAutomaticLifecyclePortfolio(connection, portfolioId) {
  const portfolios = await queryRows(
    connection,
    'SELECT * FROM portfolios WHERE id=? FOR UPDATE',
    [portfolioId],
  );
  if (!portfolios.length) {
    throw new ManagedConversationError(404, 'Portfolio not found', 'PORTFOLIO_NOT_FOUND');
  }
  return portfolios[0];
}

async function lockAutomaticLifecycleState(connection, portfolioId) {
  const portfolio = await lockAutomaticLifecyclePortfolio(connection, portfolioId);
  const conversation = await loadConversationForPortfolio(connection, portfolioId);
  assertConsistentAssignment(portfolio, conversation);
  return { portfolio, conversation };
}

async function activeMemberIds(connection, conversationId) {
  const rows = await queryRows(
    connection,
    `SELECT user_id
       FROM conversation_members
      WHERE conversation_id=? AND membership_status='active'
      FOR UPDATE`,
    [conversationId],
  );
  return [...new Set(rows.map((row) => Number(row.user_id)))];
}

async function notifyConversationArchived(connection, conversation, actorId, recipients) {
  await insertNotifications(
    connection,
    recipients
      .filter((userId) => userId !== actorId)
      .map((userId) => [
        userId,
        'conversation_archived',
        'Conversation Archived',
        `The managed conversation for "${conversation.title}" is now read-only`,
        conversation.portfolio_id == null ? null : Number(conversation.portfolio_id),
        Number(conversation.id),
        actorId,
      ]),
  );
}

async function applyAutomaticArchive(connection, conversation, reason, actorId) {
  if (
    conversation.status === 'archived'
    && !shouldReplaceArchiveReason(conversation.archived_reason, reason)
  ) {
    return { conversationId: Number(conversation.id), changed: false };
  }
  const recipients = await activeMemberIds(connection, conversation.id);
  await connection.query(
    `UPDATE conversations
        SET status='archived',archived_reason=?
      WHERE id=?`,
    [reason, conversation.id],
  );
  await notifyConversationArchived(
    connection,
    conversation,
    Number(actorId),
    recipients,
  );
  conversation.status = 'archived';
  conversation.archived_reason = reason;
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
  const { conversation } = await lockAutomaticLifecycleState(
    connection,
    portfolioId,
  );
  if (!conversation) return { conversationId: null, changed: false };
  return applyAutomaticArchive(connection, conversation, reason, actorId);
}

async function activeEligibleInvestorIds(connection, conversationId, portfolioId) {
  const rows = await queryRows(
    connection,
    `SELECT cm.user_id
       FROM conversation_members cm
       JOIN investor_interests ii
         ON ii.investor_id=cm.user_id
        AND ii.portfolio_id=?
      WHERE cm.conversation_id=?
        AND cm.member_role='investor'
        AND cm.membership_status='active'
      ORDER BY cm.user_id
      FOR UPDATE`,
    [portfolioId, conversationId],
  );
  return [...new Set(rows.map((row) => Number(row.user_id)))];
}

async function removeManagedInvestor({
  database = defaultDatabase,
  managerId: managerIdValue,
  conversationId: conversationIdValue,
  investorId: investorIdValue,
}) {
  const managerId = positiveId(managerIdValue, 'manager ID');
  const conversationId = positiveId(conversationIdValue, 'conversation ID');
  const investorId = positiveId(investorIdValue, 'investor ID');

  return inTransaction(database, async (connection) => {
    const { portfolio, conversation } = await lockManagedContext(
      connection,
      conversationId,
      managerId,
    );
    assertApprovedPortfolio(
      portfolio,
      'Investors can only be removed while the portfolio is approved',
    );
    const portfolioId = Number(portfolio.id);

    await queryRows(
      connection,
      `SELECT id,investor_id,portfolio_id
         FROM investor_interests
        WHERE investor_id=? AND portfolio_id=?
        FOR UPDATE`,
      [investorId, portfolioId],
    );
    const memberships = await queryRows(
      connection,
      `SELECT user_id,member_role,membership_status
         FROM conversation_members
        WHERE conversation_id=? AND user_id=? AND member_role='investor'
        FOR UPDATE`,
      [conversationId, investorId],
    );
    const membership = memberships[0];
    if (!membership) {
      throw new ManagedConversationError(
        404,
        'Investor membership not found',
        'INVESTOR_MEMBERSHIP_NOT_FOUND',
      );
    }

    const eligibleBefore = await activeEligibleInvestorIds(
      connection,
      conversationId,
      portfolioId,
    );
    const owners = await queryRows(
      connection,
      `SELECT user_id
         FROM conversation_members
        WHERE conversation_id=?
          AND member_role='business_owner'
          AND membership_status='active'
        FOR UPDATE`,
      [conversationId],
    );

    if (membership.membership_status !== 'active') {
      return {
        changed: false,
        investor_id: investorId,
        archived: conversation.status === 'archived',
      };
    }

    await connection.query(
      `UPDATE conversation_members
          SET membership_status='removed',left_at=CURRENT_TIMESTAMP
        WHERE conversation_id=? AND user_id=? AND member_role='investor'
          AND membership_status='active'`,
      [conversationId, investorId],
    );

    const remainingEligible = eligibleBefore.filter((userId) => userId !== investorId);
    if (remainingEligible.length === 0) {
      await applyAutomaticArchive(
        connection,
        conversation,
        'no_active_investors',
        managerId,
      );
    }

    const ownerIds = owners.map((owner) => Number(owner.user_id));
    const values = [[
      investorId,
      'conversation_member_removed',
      'Conversation Access Removed',
      `You were removed from the managed conversation for "${portfolio.name}"`,
      portfolioId,
      null,
      managerId,
    ]];
    for (const ownerId of [...new Set(ownerIds)]) {
      if (ownerId === investorId) continue;
      values.push([
        ownerId,
        'conversation_member_removed',
        'Investor Removed from Conversation',
        `An investor was removed from the managed conversation for "${portfolio.name}"`,
        portfolioId,
        conversationId,
        managerId,
      ]);
    }
    await insertNotifications(connection, values);

    return {
      changed: true,
      investor_id: investorId,
      archived: conversation.status === 'archived',
    };
  });
}

function withdrawalNotificationValues({
  portfolio,
  conversationId,
  investorId,
}) {
  const recipients = [
    portfolio.relationship_manager_id == null
      ? null
      : Number(portfolio.relationship_manager_id),
    Number(portfolio.owner_id),
  ].filter((userId) => userId != null && userId !== investorId);
  return [...new Set(recipients)].map((userId) => [
    userId,
    'conversation_member_removed',
    'Investor Withdrew Interest',
    `An investor withdrew interest from "${portfolio.name}"`,
    Number(portfolio.id),
    conversationId,
    investorId,
  ]);
}

async function withdrawInvestorInterest({
  database = defaultDatabase,
  investorId: investorIdValue,
  portfolioId: portfolioIdValue,
}) {
  const investorId = positiveId(investorIdValue, 'investor ID');
  const portfolioId = positiveId(portfolioIdValue, 'portfolio ID');
  return inTransaction(database, async (connection) => {
    const portfolio = await lockPortfolio(connection, portfolioId);
    const conversation = await loadConversationForPortfolio(connection, portfolioId);
    assertConsistentAssignment(portfolio, conversation);

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

    let membership = null;
    if (conversation) {
      const memberships = await queryRows(
        connection,
        `SELECT user_id,membership_status
           FROM conversation_members
          WHERE conversation_id=? AND user_id=? AND member_role='investor'
          FOR UPDATE`,
        [conversation.id, investorId],
      );
      [membership] = memberships;
    }

    let eligibleBefore = [];
    if (conversation) {
      eligibleBefore = await activeEligibleInvestorIds(
        connection,
        conversation.id,
        portfolioId,
      );
    }

    if (conversation && membership?.membership_status === 'active') {
      await connection.query(
        `UPDATE conversation_members
            SET membership_status='removed',left_at=NOW()
          WHERE conversation_id=? AND user_id=? AND member_role='investor'
            AND membership_status='active'`,
        [conversation.id, investorId],
      );
    }
    await connection.query(
      'DELETE FROM investor_interests WHERE id=?',
      [interests[0].id],
    );

    const noActiveInvestors = Boolean(
      conversation
      && eligibleBefore.filter((userId) => userId !== investorId).length === 0
    );
    if (noActiveInvestors) {
      await applyAutomaticArchive(
        connection,
        conversation,
        'no_active_investors',
        investorId,
      );
    }

    const conversationId = conversation ? Number(conversation.id) : null;
    await insertNotifications(
      connection,
      withdrawalNotificationValues({
        portfolio,
        conversationId,
        investorId,
      }),
    );

    return {
      removed: true,
      conversation_id: conversationId,
      archived: noActiveInvestors || conversation?.status === 'archived',
    };
  });
}

async function reconcileConversationAfterApproval(
  connection,
  portfolioIdValue,
  actorIdValue,
) {
  const portfolioId = positiveId(portfolioIdValue, 'portfolio ID');
  const actorId = positiveId(actorIdValue, 'actor ID');
  const { conversation } = await lockAutomaticLifecycleState(
    connection,
    portfolioId,
  );
  if (!conversation) return null;

  const eligibleInvestorIds = await activeEligibleInvestorIds(
    connection,
    conversation.id,
    portfolioId,
  );

  if (conversation.archived_reason === 'portfolio_deleted') {
    return {
      conversationId: Number(conversation.id),
      status: 'archived',
      archived_reason: 'portfolio_deleted',
      changed: false,
    };
  }

  if (
    eligibleInvestorIds.length > 0
    && !(
      conversation.status === 'archived'
      && conversation.archived_reason === 'portfolio_unapproved'
    )
  ) {
    return {
      conversationId: Number(conversation.id),
      status: conversation.status,
      archived_reason: conversation.archived_reason || null,
      changed: false,
    };
  }

  const next = eligibleInvestorIds.length > 0
    ? { status: 'active', archived_reason: null }
    : { status: 'archived', archived_reason: 'no_active_investors' };

  if (
    conversation.status === next.status
    && (conversation.archived_reason || null) === next.archived_reason
  ) {
    return {
      conversationId: Number(conversation.id),
      ...next,
      changed: false,
    };
  }

  if (next.status === 'active') {
    await connection.query(
      "UPDATE conversations SET status='active',archived_reason=NULL WHERE id=?",
      [conversation.id],
    );
  } else {
    const recipients = await activeMemberIds(connection, conversation.id);
    await connection.query(
      `UPDATE conversations
          SET status='archived',archived_reason='no_active_investors'
        WHERE id=?`,
      [conversation.id],
    );
    await notifyConversationArchived(
      connection,
      conversation,
      actorId,
      recipients,
    );
  }

  return {
    conversationId: Number(conversation.id),
    ...next,
    changed: true,
  };
}

async function prepareConversationForPortfolioDeletion(
  connection,
  portfolioIdValue,
  actorIdValue,
) {
  const portfolioId = positiveId(portfolioIdValue, 'portfolio ID');
  const actorId = positiveId(actorIdValue, 'actor ID');
  const { conversation } = await lockAutomaticLifecycleState(
    connection,
    portfolioId,
  );
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
  createManagedConversation,
  prepareConversationForPortfolioDeletion,
  reconcileConversationAfterApproval,
  removeManagedInvestor,
  withdrawInvestorInterest,
};

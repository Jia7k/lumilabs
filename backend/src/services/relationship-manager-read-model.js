class RelationshipManagerReadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requirePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function relationshipManagerActions(portfolio) {
  const approved = portfolio.status === 'approved';
  const hasConversation = portfolio.conversation !== null;
  const eligible = portfolio.interests.filter((item) => !item.is_active_member);
  return {
    can_create_conversation:
      approved && !hasConversation && portfolio.interests.length > 0,
    create_disabled_reason:
      !approved
        ? 'Portfolio must be approved before creating a chat'
        : hasConversation
          ? 'This portfolio already has its group chat'
          : portfolio.interests.length === 0
            ? 'Create chat becomes available after an investor expresses interest'
            : null,
    can_add_investors: approved && hasConversation && eligible.length > 0,
    add_disabled_reason:
      !hasConversation
        ? 'Create the portfolio chat first'
        : !approved
          ? 'Portfolio must be approved before adding investors'
          : eligible.length === 0
            ? 'No additional interested investors are available'
            : null,
  };
}

function normalizePortfolio(row) {
  const {
    id: ignoredId,
    portfolio_id: portfolioId,
    owner_id: ignoredOwnerId,
    relationship_manager_id: ignoredManagerId,
    owner_user_id: ownerId,
    owner_name: ownerName,
    owner_email: ownerEmail,
    conversation_id: conversationId,
    conversation_title: conversationTitle,
    conversation_status: conversationStatus,
    conversation_archived_reason: conversationArchivedReason,
    unread_count: unreadCount,
    manager_visible_after_message_id: ignoredVisibleAfter,
    manager_last_read_message_id: ignoredLastRead,
    ...details
  } = row;

  return {
    id: Number(portfolioId),
    ...details,
    owner: {
      id: Number(ownerId),
      name: ownerName,
      email: ownerEmail,
    },
    conversation: conversationId == null
      ? null
      : {
        id: Number(conversationId),
        title: conversationTitle,
        status: conversationStatus,
        archived_reason: conversationArchivedReason || null,
        unread_count: Number(unreadCount || 0),
      },
    interests: [],
    participants: [],
    documents: [],
  };
}

function addUnique(collection, keys, key, value) {
  if (keys.has(key)) return;
  keys.add(key);
  collection.push(value);
}

function attachInterests(portfoliosById, rows) {
  const keysByPortfolio = new Map();
  for (const row of rows) {
    const portfolioId = Number(row.portfolio_id);
    const portfolio = portfoliosById.get(portfolioId);
    if (!portfolio) continue;
    if (!keysByPortfolio.has(portfolioId)) keysByPortfolio.set(portfolioId, new Set());
    addUnique(
      portfolio.interests,
      keysByPortfolio.get(portfolioId),
      Number(row.interest_id),
      {
        interest_id: Number(row.interest_id),
        investor: {
          id: Number(row.investor_id),
          name: row.investor_name,
          email: row.investor_email,
        },
        is_active_member: Boolean(row.is_active_member),
      },
    );
  }
}

function attachParticipants(portfoliosById, rows) {
  const keysByPortfolio = new Map();
  for (const row of rows) {
    const portfolioId = Number(row.portfolio_id);
    const portfolio = portfoliosById.get(portfolioId);
    if (!portfolio) continue;
    if (!keysByPortfolio.has(portfolioId)) keysByPortfolio.set(portfolioId, new Set());
    addUnique(
      portfolio.participants,
      keysByPortfolio.get(portfolioId),
      `${row.conversation_id}:${row.user_id}`,
      {
        id: Number(row.user_id),
        name: row.user_name,
        email: row.user_email,
        role: row.member_role,
        joined_at: row.joined_at,
      },
    );
  }
}

function attachDocuments(portfoliosById, rows) {
  const keysByPortfolio = new Map();
  for (const row of rows) {
    const portfolioId = Number(row.portfolio_id);
    const portfolio = portfoliosById.get(portfolioId);
    if (!portfolio) continue;
    if (!keysByPortfolio.has(portfolioId)) keysByPortfolio.set(portfolioId, new Set());
    const documentId = Number(row.document_id);
    addUnique(
      portfolio.documents,
      keysByPortfolio.get(portfolioId),
      documentId,
      {
        id: documentId,
        file_name: row.file_name,
        file_type: row.file_type,
        uploaded_at: row.uploaded_at,
        download_url: `/api/portfolios/${portfolioId}/documents/${documentId}/download`,
      },
    );
  }
}

function assignedWhere(portfolioId) {
  return portfolioId === undefined
    ? {
      clause: 'WHERE p.relationship_manager_id=?',
      suffix: 'ORDER BY p.id',
    }
    : {
      clause: 'WHERE p.relationship_manager_id=? AND p.id=?',
      suffix: '',
    };
}

async function loadPortfolioRows(database, managerId, portfolioId) {
  const { clause, suffix } = assignedWhere(portfolioId);
  const params = portfolioId === undefined
    ? [managerId]
    : [managerId, portfolioId];
  const [rows] = await database.query(
    `SELECT p.*,
            p.id AS portfolio_id,
            owner.id AS owner_user_id,
            owner.name AS owner_name,
            owner.email AS owner_email,
            c.id AS conversation_id,
            c.title AS conversation_title,
            c.status AS conversation_status,
            c.archived_reason AS conversation_archived_reason,
            manager_member.visible_after_message_id
              AS manager_visible_after_message_id,
            manager_member.last_read_message_id
              AS manager_last_read_message_id,
            COALESCE((
              SELECT COUNT(*)
                FROM messages unread_message
               WHERE manager_member.user_id IS NOT NULL
                 AND unread_message.conversation_id=c.id
                 AND unread_message.id>GREATEST(
                   manager_member.visible_after_message_id,
                   manager_member.last_read_message_id
                 )
                 AND unread_message.sender_id<>manager_member.user_id
            ),0) AS unread_count
       FROM portfolios p
       JOIN users owner ON owner.id=p.owner_id
       LEFT JOIN conversations c ON c.portfolio_id=p.id
       LEFT JOIN conversation_members manager_member
         ON manager_member.conversation_id=c.id
        AND manager_member.user_id=p.relationship_manager_id
        AND manager_member.member_role='relationship_manager'
        AND manager_member.membership_status='active'
      ${clause}
      ${suffix}`,
    params,
  );
  return rows;
}

async function loadInterestRows(database, managerId, portfolioId) {
  const { clause, suffix } = assignedWhere(portfolioId);
  const params = portfolioId === undefined
    ? [managerId]
    : [managerId, portfolioId];
  const [rows] = await database.query(
    `SELECT p.id AS portfolio_id,
            ii.id AS interest_id,
            investor.id AS investor_id,
            investor.name AS investor_name,
            investor.email AS investor_email,
            CASE WHEN active_member.user_id IS NULL THEN 0 ELSE 1 END
              AS is_active_member
       FROM portfolios p
       JOIN investor_interests ii ON ii.portfolio_id=p.id
       JOIN users investor
         ON investor.id=ii.investor_id
        AND investor.role='investor'
       LEFT JOIN conversations c ON c.portfolio_id=p.id
       LEFT JOIN conversation_members active_member
         ON active_member.conversation_id=c.id
        AND active_member.user_id=ii.investor_id
        AND active_member.member_role='investor'
        AND active_member.membership_status='active'
      ${clause}
      ${suffix ? 'ORDER BY p.id,ii.created_at,ii.id' : 'ORDER BY ii.created_at,ii.id'}`,
    params,
  );
  return rows;
}

async function loadParticipantRows(database, managerId, portfolioId) {
  const { clause } = assignedWhere(portfolioId);
  const params = portfolioId === undefined
    ? [managerId]
    : [managerId, portfolioId];
  const [rows] = await database.query(
    `SELECT p.id AS portfolio_id,
            c.id AS conversation_id,
            participant.id AS user_id,
            participant.name AS user_name,
            participant.email AS user_email,
            cm.member_role,
            cm.joined_at
       FROM portfolios p
       JOIN conversations c ON c.portfolio_id=p.id
       JOIN conversation_members cm
         ON cm.conversation_id=c.id
        AND cm.membership_status='active'
       JOIN users participant ON participant.id=cm.user_id
      ${clause}
      ORDER BY p.id,
               FIELD(cm.member_role,'relationship_manager','business_owner','investor'),
               participant.name,participant.id`,
    params,
  );
  return rows;
}

async function loadDocumentRows(database, managerId, portfolioId) {
  const { clause } = assignedWhere(portfolioId);
  const params = portfolioId === undefined
    ? [managerId]
    : [managerId, portfolioId];
  const [rows] = await database.query(
    `SELECT p.id AS portfolio_id,
            d.id AS document_id,
            d.file_name,
            d.file_type,
            d.uploaded_at
       FROM portfolios p
       JOIN portfolio_documents d ON d.portfolio_id=p.id
      ${clause}
      ORDER BY p.id,d.uploaded_at DESC,d.id DESC`,
    params,
  );
  return rows;
}

async function loadAssignedWorkspace(database, managerId, portfolioId) {
  const portfolioRows = await loadPortfolioRows(database, managerId, portfolioId);
  if (portfolioId !== undefined && portfolioRows.length === 0) {
    throw new RelationshipManagerReadError(
      403,
      'Portfolio is not assigned to this relationship manager',
    );
  }
  const portfolios = portfolioRows.map(normalizePortfolio);
  const portfoliosById = new Map(portfolios.map((portfolio) => [portfolio.id, portfolio]));

  const interestRows = await loadInterestRows(database, managerId, portfolioId);
  const participantRows = await loadParticipantRows(database, managerId, portfolioId);
  const documentRows = await loadDocumentRows(database, managerId, portfolioId);
  attachInterests(portfoliosById, interestRows);
  attachParticipants(portfoliosById, participantRows);
  attachDocuments(portfoliosById, documentRows);

  for (const portfolio of portfolios) {
    portfolio.actions = relationshipManagerActions(portfolio);
  }
  return portfolios;
}

async function loadRelationshipManagerDashboard({ database, managerId }) {
  requirePositiveSafeInteger(managerId, 'managerId');
  const portfolios = await loadAssignedWorkspace(database, managerId);
  return {
    stats: {
      assigned_portfolios: portfolios.length,
      approved_portfolios: portfolios.filter(({ status }) => status === 'approved').length,
      eligible_interests: portfolios.reduce(
        (total, portfolio) => (
          total + portfolio.interests.filter((item) => !item.is_active_member).length
        ),
        0,
      ),
      active_rooms: portfolios.filter(
        ({ conversation }) => conversation && conversation.status === 'active',
      ).length,
      unread_messages: portfolios.reduce(
        (total, portfolio) => total + (portfolio.conversation?.unread_count || 0),
        0,
      ),
    },
    portfolios,
  };
}

async function loadAssignedPortfolio({
  database,
  managerId,
  portfolioId,
}) {
  requirePositiveSafeInteger(managerId, 'managerId');
  requirePositiveSafeInteger(portfolioId, 'portfolioId');
  const [rows] = await database.query(
    'SELECT id,relationship_manager_id FROM portfolios WHERE id=?',
    [portfolioId],
  );
  if (rows.length === 0) {
    throw new RelationshipManagerReadError(404, 'Portfolio not found');
  }
  if (Number(rows[0].relationship_manager_id) !== managerId) {
    throw new RelationshipManagerReadError(
      403,
      'Portfolio is not assigned to this relationship manager',
    );
  }
  const [portfolio] = await loadAssignedWorkspace(database, managerId, portfolioId);
  return portfolio;
}

module.exports = {
  RelationshipManagerReadError,
  loadAssignedPortfolio,
  loadRelationshipManagerDashboard,
  relationshipManagerActions,
};

const defaultDatabase = require('../config/db');
const { ManagedConversationError } = require('./managed-conversation-workflow');

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ManagedConversationError(400, `Invalid ${label}`, 'INVALID_ID');
  }
  return id;
}

function validatedContent(value) {
  const content = typeof value === 'string' ? value.trim() : '';
  if (!content || content.length > 2000) {
    throw new ManagedConversationError(
      400,
      'Message content must be between 1 and 2000 characters',
      'INVALID_MESSAGE',
    );
  }
  return content;
}

async function queryRows(database, sql, params = []) {
  const [rows] = await database.query(sql, params);
  return rows;
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

function normalizeParticipant(row) {
  return {
    id: Number(row.id),
    name: row.name,
    role: row.role,
  };
}

function normalizeMessage(row) {
  return {
    id: Number(row.id),
    conversation_id: Number(row.conversation_id),
    sender_id: Number(row.sender_id),
    sender_name: row.sender_name,
    sender_role: row.sender_role,
    content: row.content,
    created_at: row.created_at,
  };
}

async function listAccessibleConversations({
  database = defaultDatabase,
  userId: userIdValue,
}) {
  const userId = positiveId(userIdValue, 'user ID');
  const summaries = await queryRows(
    database,
    `SELECT c.id,c.portfolio_id,c.title,c.status,c.archived_reason,
            COALESCE((
              SELECT COUNT(*)
                FROM messages unread_message
               WHERE unread_message.conversation_id=c.id
                 AND unread_message.id>GREATEST(cm.visible_after_message_id,cm.last_read_message_id)
                 AND unread_message.sender_id<>cm.user_id
            ),0) AS unread_count,
            latest.id AS latest_message_id,
            latest.sender_id AS latest_sender_id,
            latest_sender.name AS latest_sender_name,
            latest.content AS latest_content,
            latest.created_at AS latest_created_at
       FROM conversation_members cm
       JOIN conversations c ON c.id=cm.conversation_id
       LEFT JOIN messages latest ON latest.id=(
         SELECT MAX(candidate.id)
           FROM messages candidate
          WHERE candidate.conversation_id=c.id
            AND candidate.id>cm.visible_after_message_id
       )
       LEFT JOIN users latest_sender ON latest_sender.id=latest.sender_id
      WHERE cm.user_id=? AND cm.membership_status='active'
      ORDER BY COALESCE(latest.created_at,c.updated_at) DESC,c.id DESC`,
    [userId],
  );
  if (!summaries.length) return [];

  const conversationIds = summaries.map((summary) => Number(summary.id));
  const placeholders = conversationIds.map(() => '?').join(',');
  const participantRows = await queryRows(
    database,
    `SELECT cm.conversation_id,u.id,u.name,cm.member_role AS role
       FROM conversation_members cm
       JOIN users u ON u.id=cm.user_id
      WHERE cm.conversation_id IN (${placeholders})
        AND cm.membership_status='active'
      ORDER BY cm.conversation_id,
               FIELD(cm.member_role,'relationship_manager','business_owner','investor'),
               u.name,u.id`,
    conversationIds,
  );
  const participantsByConversation = new Map();
  for (const row of participantRows) {
    const conversationId = Number(row.conversation_id);
    if (!participantsByConversation.has(conversationId)) {
      participantsByConversation.set(conversationId, []);
    }
    participantsByConversation.get(conversationId).push(normalizeParticipant(row));
  }

  return summaries.map((summary) => {
    const id = Number(summary.id);
    return {
      id,
      portfolio_id: summary.portfolio_id == null ? null : Number(summary.portfolio_id),
      title: summary.title,
      status: summary.status,
      archived_reason: summary.archived_reason || null,
      unread_count: Number(summary.unread_count || 0),
      participants: participantsByConversation.get(id) || [],
      latest_message: summary.latest_message_id == null ? null : {
        id: Number(summary.latest_message_id),
        sender_id: Number(summary.latest_sender_id),
        sender_name: summary.latest_sender_name,
        content: summary.latest_content,
        created_at: summary.latest_created_at,
      },
    };
  });
}

async function loadAccess(database, userId, conversationId, lock = false) {
  const accessRows = await queryRows(
    database,
    `SELECT c.id,c.portfolio_id,c.title,c.status,c.archived_reason,
            cm.user_id,cm.member_role,cm.membership_status,
            cm.visible_after_message_id,cm.last_read_message_id,
            COALESCE((
              SELECT COUNT(*)
                FROM messages unread_message
               WHERE unread_message.conversation_id=c.id
                 AND unread_message.id>GREATEST(cm.visible_after_message_id,cm.last_read_message_id)
                 AND unread_message.sender_id<>cm.user_id
            ),0) AS unread_count
       FROM conversations c
       LEFT JOIN conversation_members cm
         ON cm.conversation_id=c.id AND cm.user_id=?
      WHERE c.id=?
      ${lock ? 'FOR UPDATE' : ''}`,
    [userId, conversationId],
  );
  if (!accessRows.length) {
    throw new ManagedConversationError(404, 'Conversation not found', 'ROOM_NOT_FOUND');
  }
  const access = accessRows[0];
  if (!access.user_id || access.membership_status !== 'active') {
    throw new ManagedConversationError(
      403,
      'You do not have access to this conversation',
      'ROOM_ACCESS_DENIED',
    );
  }
  return access;
}

async function loadConversationThread({
  database = defaultDatabase,
  userId: userIdValue,
  conversationId: conversationIdValue,
}) {
  const userId = positiveId(userIdValue, 'user ID');
  const conversationId = positiveId(conversationIdValue, 'conversation ID');
  const access = await loadAccess(database, userId, conversationId);
  const participants = await queryRows(
    database,
    `SELECT u.id,u.name,cm.member_role AS role
       FROM conversation_members cm
       JOIN users u ON u.id=cm.user_id
      WHERE cm.conversation_id=? AND cm.membership_status='active'
      ORDER BY FIELD(cm.member_role,'relationship_manager','business_owner','investor'),
               u.name,u.id`,
    [conversationId],
  );
  const boundary = Number(access.visible_after_message_id || 0);
  const messages = await queryRows(
    database,
    `SELECT m.id,m.conversation_id,m.sender_id,u.name AS sender_name,
            cm.member_role AS sender_role,m.content,m.created_at
       FROM messages m
       JOIN users u ON u.id=m.sender_id
       JOIN conversation_members cm
         ON cm.conversation_id=m.conversation_id AND cm.user_id=m.sender_id
      WHERE m.conversation_id=? AND m.id>?
      ORDER BY m.id`,
    [conversationId, boundary],
  );
  const normalizedMessages = messages.map(normalizeMessage);
  const latestMessage = normalizedMessages.at(-1);
  return {
    conversation: {
      id: conversationId,
      portfolio_id: access.portfolio_id == null ? null : Number(access.portfolio_id),
      title: access.title,
      status: access.status,
      archived_reason: access.archived_reason || null,
      can_send: access.status === 'active',
      unread_count: Number(access.unread_count || 0),
      latest_message: latestMessage ? {
        id: latestMessage.id,
        sender_id: latestMessage.sender_id,
        sender_name: latestMessage.sender_name,
        content: latestMessage.content,
        created_at: latestMessage.created_at,
      } : null,
    },
    participants: participants.map(normalizeParticipant),
    messages: normalizedMessages,
  };
}

async function markConversationRead({
  database = defaultDatabase,
  userId: userIdValue,
  conversationId: conversationIdValue,
  messageId: messageIdValue,
}) {
  const userId = positiveId(userIdValue, 'user ID');
  const conversationId = positiveId(conversationIdValue, 'conversation ID');
  const messageId = positiveId(messageIdValue, 'message ID');
  return inTransaction(database, async (connection) => {
    const access = await loadAccess(connection, userId, conversationId, true);
    const messages = await queryRows(
      connection,
      'SELECT id,conversation_id FROM messages WHERE id=? AND conversation_id=? FOR UPDATE',
      [messageId, conversationId],
    );
    if (!messages.length || messageId <= Number(access.visible_after_message_id || 0)) {
      throw new ManagedConversationError(
        400,
        'Read cursor is not visible in this conversation',
        'INVALID_READ_CURSOR',
      );
    }
    await connection.query(
      `UPDATE conversation_members
          SET last_read_message_id=GREATEST(last_read_message_id,?)
        WHERE conversation_id=? AND user_id=? AND membership_status='active'`,
      [messageId, conversationId, userId],
    );
    await connection.query(
      `UPDATE notifications
          SET read_at=COALESCE(read_at,NOW())
        WHERE user_id=? AND type='new_message'
          AND related_conversation_id=?
          AND related_message_id<=?`,
      [userId, conversationId, messageId],
    );
    return {
      conversation_id: conversationId,
      last_read_message_id: Math.max(
        Number(access.last_read_message_id || 0),
        messageId,
      ),
    };
  });
}

async function sendConversationMessage({
  database = defaultDatabase,
  user,
  conversationId: conversationIdValue,
  content: contentValue,
}) {
  const senderId = positiveId(user?.id, 'sender ID');
  const conversationId = positiveId(conversationIdValue, 'conversation ID');
  const content = validatedContent(contentValue);
  return inTransaction(database, async (connection) => {
    const access = await loadAccess(connection, senderId, conversationId, true);
    if (access.status !== 'active') {
      throw new ManagedConversationError(
        409,
        'Archived conversations are read-only',
        'ROOM_ARCHIVED',
      );
    }
    const recipients = await queryRows(
      connection,
      `SELECT user_id
         FROM conversation_members
        WHERE conversation_id=?
          AND membership_status='active'
          AND user_id<>?
        FOR UPDATE`,
      [conversationId, senderId],
    );
    const [inserted] = await connection.query(
      'INSERT INTO messages (conversation_id,sender_id,content) VALUES (?,?,?)',
      [conversationId, senderId, content],
    );
    const messageId = Number(inserted.insertId);
    if (recipients.length) {
      const values = recipients.map(({ user_id: userId }) => [
        Number(userId),
        'new_message',
        'New Message',
        `${user.name} sent a message in "${access.title}"`,
        access.portfolio_id == null ? null : Number(access.portfolio_id),
        conversationId,
        messageId,
        senderId,
      ]);
      await connection.query(
        `INSERT INTO notifications
          (user_id,type,title,body,related_portfolio_id,related_conversation_id,
           related_message_id,related_user_id)
         VALUES ?`,
        [values],
      );
    }
    const saved = await queryRows(
      connection,
      `SELECT m.id,m.conversation_id,m.sender_id,u.name AS sender_name,
              cm.member_role AS sender_role,m.content,m.created_at
         FROM messages m
         JOIN users u ON u.id=m.sender_id
         JOIN conversation_members cm
           ON cm.conversation_id=m.conversation_id AND cm.user_id=m.sender_id
        WHERE m.id=?`,
      [messageId],
    );
    if (saved.length !== 1) throw new Error('Inserted message could not be read back');
    return normalizeMessage(saved[0]);
  });
}

module.exports = {
  listAccessibleConversations,
  loadConversationThread,
  markConversationRead,
  sendConversationMessage,
};

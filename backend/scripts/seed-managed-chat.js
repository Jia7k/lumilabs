const SEED_KEY = 'managed-chat-demo-v1';
const SEED_CONFIRMATION = 'SEED_X3_TESTING1_MANAGED_CHAT';

const DEMO_MESSAGES = [
  {
    author: 'manager',
    body: 'Welcome to the managed X3 conversation. I will help coordinate this discussion.',
  },
  {
    author: 'owner',
    body: 'Thanks for joining. I am happy to share more about X3 and answer your questions.',
  },
  {
    author: 'investor',
    body: 'Thank you. I am interested in learning more about X3’s traction and next milestones.',
  },
];

class ManagedChatSeedError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function positiveEnvironmentId(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} must be a positive ID`);
  return id;
}

function resolveSeedConfig(environment) {
  if (environment.CONFIRM_MANAGED_CHAT_SEED !== SEED_CONFIRMATION) {
    throw new Error('Exact managed chat seed confirmation is required');
  }
  if (environment.MANAGED_CHAT_SEED_KEY !== SEED_KEY) {
    throw new Error('Exact managed chat seed key is required');
  }

  const managerId = positiveEnvironmentId(
    environment.MANAGED_CHAT_MANAGER_ID,
    'Managed chat manager',
    { optional: true },
  );
  const managerEmail = String(environment.MANAGED_CHAT_MANAGER_EMAIL || '')
    .trim()
    .toLowerCase() || null;
  if (!managerId && !managerEmail) {
    throw new Error('An explicit manager email or manager ID is required');
  }

  return {
    seedKey: SEED_KEY,
    managerEmail,
    managerId,
    portfolioId: positiveEnvironmentId(
      environment.MANAGED_CHAT_PORTFOLIO_ID,
      'Managed chat portfolio',
    ),
    investorId: positiveEnvironmentId(
      environment.MANAGED_CHAT_INVESTOR_ID,
      'Managed chat investor',
    ),
  };
}

async function rows(connection, sql, params = []) {
  const [result] = await connection.query(sql, params);
  return result;
}

function seedConflict(message, code) {
  throw new ManagedChatSeedError(message, code);
}

function validatePortfolio(portfolios) {
  const portfolio = portfolios[0];
  if (
    portfolios.length !== 1
    || portfolio.name !== 'X3'
    || portfolio.owner_name !== 'Beta'
    || portfolio.status !== 'approved'
  ) {
    seedConflict(
      'Seed portfolio must be the approved X3 portfolio owned by Beta',
      'INVALID_DEMO_PORTFOLIO',
    );
  }
  return portfolio;
}

function validateManager(managers) {
  const manager = managers[0];
  if (managers.length !== 1 || manager.role !== 'relationship_manager') {
    seedConflict(
      'Seed manager must resolve to exactly one relationship manager',
      'INVALID_DEMO_MANAGER',
    );
  }
  return manager;
}

function validateInvestor(investors) {
  const investor = investors[0];
  if (
    investors.length !== 1
    || investor.role !== 'investor'
    || investor.name !== 'testing1'
    || !investor.interest_id
  ) {
    seedConflict(
      'Seed investor must be testing1 with one active X3 interest',
      'INVALID_DEMO_INVESTOR',
    );
  }
  return investor;
}

function validateRoomIdentity(room, manager) {
  if (
    Number(room.relationship_manager_id) !== Number(manager.id)
    || room.title !== 'X3'
    || room.status !== 'active'
  ) {
    seedConflict('Existing managed room does not match the seed identities', 'SEED_ROOM_MISMATCH');
  }
}

function validateRoomMemberships(portfolio, manager, investor, memberships) {
  const activeRoleMembers = (role) => memberships.filter(
    (membership) => membership.member_role === role
      && membership.membership_status === 'active',
  );
  const managers = activeRoleMembers('relationship_manager');
  const owners = activeRoleMembers('business_owner');
  const investors = activeRoleMembers('investor');
  if (
    managers.length !== 1
    || Number(managers[0].user_id) !== Number(manager.id)
    || owners.length !== 1
    || Number(owners[0].user_id) !== Number(portfolio.owner_id)
    || !investors.some(({ user_id: userId }) => Number(userId) === Number(investor.id))
  ) {
    seedConflict('Existing managed room does not match the seed memberships', 'SEED_ROOM_MISMATCH');
  }
}

function seedMessagesComplete(messages, authors) {
  if (!messages.length) return false;
  const expected = DEMO_MESSAGES.map((message) => ({
    body: message.body,
    senderId: Number(authors[message.author]),
  }));
  const complete = messages.length === expected.length && expected.every(({ body, senderId }) => {
    const matches = messages.filter((message) => message.content === body);
    return matches.length === 1 && Number(matches[0].sender_id) === senderId;
  });
  if (!complete) {
    seedConflict(
      'The managed chat demo contains a partial or mismatched seed message set',
      'PARTIAL_SEED_MESSAGES',
    );
  }
  return true;
}

async function seedManagedChat(database, config) {
  const connection = await database.getConnection();
  let transactionOpen = false;
  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const portfolio = validatePortfolio(await rows(
      connection,
      `SELECT p.id,p.name,p.owner_id,p.status,owner.name AS owner_name
         FROM portfolios p
         JOIN users owner ON owner.id=p.owner_id
        WHERE p.id=?
        FOR UPDATE`,
      [config.portfolioId],
    ));

    const manager = validateManager(await rows(
      connection,
      config.managerId
        ? 'SELECT id,name,email,role FROM users WHERE id=? FOR UPDATE'
        : 'SELECT id,name,email,role FROM users WHERE email=? FOR UPDATE',
      [config.managerId || config.managerEmail],
    ));

    const investor = validateInvestor(await rows(
      connection,
      `SELECT u.id,u.name,u.role,ii.id AS interest_id
         FROM users u
         JOIN investor_interests ii
           ON ii.investor_id=u.id AND ii.portfolio_id=?
        WHERE u.id=?
        FOR UPDATE`,
      [config.portfolioId, config.investorId],
    ));

    const conversations = await rows(
      connection,
      `SELECT id,portfolio_id,relationship_manager_id,title,status
         FROM conversations
        WHERE portfolio_id=?
        FOR UPDATE`,
      [config.portfolioId],
    );
    let conversationId;
    if (!conversations.length) {
      const [inserted] = await connection.query(
        `INSERT INTO conversations
          (portfolio_id,relationship_manager_id,title,status)
         VALUES (?,?,?,'active')`,
        [config.portfolioId, Number(manager.id), 'X3'],
      );
      conversationId = Number(inserted.insertId);
      await connection.query(
        `INSERT INTO conversation_members
          (conversation_id,user_id,member_role,visible_after_message_id,last_read_message_id)
         VALUES ?`,
        [[
          [conversationId, Number(manager.id), 'relationship_manager', 0, 0],
          [conversationId, Number(portfolio.owner_id), 'business_owner', 0, 0],
          [conversationId, Number(investor.id), 'investor', 0, 0],
        ]],
      );
    } else {
      if (conversations.length !== 1) {
        seedConflict('More than one room exists for the X3 portfolio', 'SEED_ROOM_MISMATCH');
      }
      const room = conversations[0];
      conversationId = Number(room.id);
      validateRoomIdentity(room, manager);
      const memberships = await rows(
        connection,
        `SELECT user_id,member_role,membership_status
           FROM conversation_members
          WHERE conversation_id=?
          FOR UPDATE`,
        [conversationId],
      );
      validateRoomMemberships(portfolio, manager, investor, memberships);
    }

    const bodies = DEMO_MESSAGES.map(({ body }) => body);
    const seedMessages = await rows(
      connection,
      `SELECT id,sender_id,content
         FROM messages
        WHERE conversation_id=? AND content IN (?,?,?)
        FOR UPDATE`,
      [conversationId, ...bodies],
    );
    const authors = {
      manager: Number(manager.id),
      owner: Number(portfolio.owner_id),
      investor: Number(investor.id),
    };
    const alreadyComplete = seedMessagesComplete(seedMessages, authors);
    if (!alreadyComplete) {
      await connection.query(
        'INSERT INTO messages (conversation_id,sender_id,content) VALUES ?',
        [DEMO_MESSAGES.map(({ author, body }) => [conversationId, authors[author], body])],
      );
    }

    await connection.commit();
    transactionOpen = false;
    return { created: !alreadyComplete, conversation_id: conversationId };
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

async function main() {
  require('dotenv').config();
  const database = require('../src/config/db');
  try {
    const result = await seedManagedChat(database, resolveSeedConfig(process.env));
    console.log(`Managed chat demo ready in conversation ${result.conversation_id}`);
  } finally {
    await database.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Managed chat seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEMO_MESSAGES,
  ManagedChatSeedError,
  SEED_CONFIRMATION,
  SEED_KEY,
  resolveSeedConfig,
  seedManagedChat,
};

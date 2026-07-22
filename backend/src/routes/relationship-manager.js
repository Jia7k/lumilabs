const express = require('express');
const { body, param, validationResult } = require('express-validator');
const defaultDatabase = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const managedConversationWorkflow = require('../services/managed-conversation-workflow');

const interestIdsValidation = [
  body('interest_ids').isArray({ min: 1 }),
  body('interest_ids.*').isInt({ min: 1 }).toInt(),
];

function sendValidationErrors(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ errors: errors.array() });
  return true;
}

function sendWorkflowError(error, res) {
  if (error instanceof managedConversationWorkflow.ManagedConversationError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(error);
  return res.status(500).json({ error: 'Server error' });
}

function groupUnclaimedPortfolios(rows) {
  const portfolios = new Map();
  for (const row of rows) {
    const portfolioId = Number(row.portfolio_id);
    if (!portfolios.has(portfolioId)) {
      portfolios.set(portfolioId, {
        portfolio_id: portfolioId,
        portfolio_name: row.portfolio_name,
        owner: { id: Number(row.owner_id), name: row.owner_name },
        interests: [],
      });
    }
    portfolios.get(portfolioId).interests.push({
      id: Number(row.interest_id),
      investor: { id: Number(row.investor_id), name: row.investor_name },
      created_at: row.interest_created_at,
    });
  }
  return [...portfolios.values()];
}

function groupRooms(roomRows, investorRows, eligibleRows) {
  const investors = new Map();
  for (const row of investorRows) {
    const conversationId = Number(row.conversation_id);
    if (!investors.has(conversationId)) investors.set(conversationId, []);
    investors.get(conversationId).push({
      id: Number(row.investor_id),
      name: row.investor_name,
    });
  }

  const eligible = new Map();
  for (const row of eligibleRows) {
    const conversationId = Number(row.conversation_id);
    if (!eligible.has(conversationId)) eligible.set(conversationId, []);
    eligible.get(conversationId).push({
      id: Number(row.interest_id),
      investor: { id: Number(row.investor_id), name: row.investor_name },
    });
  }

  return roomRows.map((row) => {
    const conversationId = Number(row.conversation_id);
    return {
      conversation_id: conversationId,
      portfolio_id: row.portfolio_id == null ? null : Number(row.portfolio_id),
      title: row.title,
      status: row.status,
      archived_reason: row.archived_reason || null,
      unread_count: Number(row.unread_count || 0),
      owner: { id: Number(row.owner_id), name: row.owner_name },
      investors: investors.get(conversationId) || [],
      eligible_interests: eligible.get(conversationId) || [],
    };
  });
}

async function loadDashboard(database, managerId) {
  const [unclaimedRows] = await database.query(
    `SELECT p.id AS portfolio_id,p.name AS portfolio_name,
            owner.id AS owner_id,owner.name AS owner_name,
            ii.id AS interest_id,investor.id AS investor_id,
            investor.name AS investor_name,ii.created_at AS interest_created_at
       FROM portfolios p
       JOIN users owner ON owner.id=p.owner_id
       JOIN investor_interests ii ON ii.portfolio_id=p.id
       JOIN users investor ON investor.id=ii.investor_id AND investor.role='investor'
       LEFT JOIN conversations c ON c.portfolio_id=p.id
      WHERE p.status='approved' AND c.id IS NULL
      ORDER BY ii.created_at,ii.id`,
  );

  const [roomRows] = await database.query(
    `SELECT c.id AS conversation_id,c.portfolio_id,c.title,c.status,c.archived_reason,
            owner.id AS owner_id,owner.name AS owner_name,
            COALESCE((
              SELECT COUNT(*) FROM messages m
               WHERE m.conversation_id=c.id
                 AND m.id>GREATEST(manager_member.visible_after_message_id,
                                   manager_member.last_read_message_id)
                 AND m.sender_id<>manager_member.user_id
            ),0) AS unread_count
       FROM conversations c
       JOIN conversation_members manager_member
         ON manager_member.conversation_id=c.id
        AND manager_member.user_id=?
        AND manager_member.member_role='relationship_manager'
        AND manager_member.membership_status='active'
       JOIN conversation_members owner_member
         ON owner_member.conversation_id=c.id
        AND owner_member.member_role='business_owner'
        AND owner_member.membership_status='active'
       JOIN users owner ON owner.id=owner_member.user_id
      WHERE c.relationship_manager_id=?
      ORDER BY c.updated_at DESC,c.id DESC`,
    [managerId, managerId],
  );

  const [investorRows] = await database.query(
    `SELECT c.id AS conversation_id,u.id AS investor_id,u.name AS investor_name
       FROM conversations c
       JOIN conversation_members cm
         ON cm.conversation_id=c.id
        AND cm.member_role='investor'
        AND cm.membership_status='active'
       JOIN users u ON u.id=cm.user_id
      WHERE c.relationship_manager_id=?
      ORDER BY c.id,u.name,u.id`,
    [managerId],
  );

  const [eligibleRows] = await database.query(
    `SELECT c.id AS conversation_id,ii.id AS interest_id,
            investor.id AS investor_id,investor.name AS investor_name
       FROM conversations c
       JOIN portfolios p ON p.id=c.portfolio_id AND p.status='approved'
       JOIN investor_interests ii ON ii.portfolio_id=p.id
       JOIN users investor ON investor.id=ii.investor_id AND investor.role='investor'
       LEFT JOIN conversation_members active_investor
         ON active_investor.conversation_id=c.id
        AND active_investor.user_id=ii.investor_id
        AND active_investor.member_role='investor'
        AND active_investor.membership_status='active'
      WHERE c.relationship_manager_id=? AND active_investor.user_id IS NULL
      ORDER BY c.id,ii.created_at,ii.id`,
    [managerId],
  );

  const unclaimedPortfolios = groupUnclaimedPortfolios(unclaimedRows);
  const rooms = groupRooms(roomRows, investorRows, eligibleRows);
  const eligibleInterestIds = new Set([
    ...unclaimedPortfolios.flatMap(({ interests }) => interests.map(({ id }) => id)),
    ...rooms.flatMap(({ eligible_interests: interests }) => interests.map(({ id }) => id)),
  ]);
  const businesses = new Set(
    rooms.map(({ portfolio_id: portfolioId }) => portfolioId).filter(Boolean),
  );

  return {
    stats: {
      eligible_interests: eligibleInterestIds.size,
      active_rooms: rooms.filter(({ status }) => status === 'active').length,
      businesses_overseen: businesses.size,
      unread_messages: rooms.reduce((total, room) => total + room.unread_count, 0),
    },
    unclaimed_portfolios: unclaimedPortfolios,
    rooms,
  };
}

function createRelationshipManagerRouter(options = {}) {
  const database = options.database || defaultDatabase;
  const workflow = { ...managedConversationWorkflow, ...options.workflow };
  const router = express.Router();
  router.use(authenticate, requireRole('relationship_manager'));

  router.get('/dashboard', async (req, res) => {
    try {
      return res.json(await loadDashboard(database, Number(req.user.id)));
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  router.post(
    '/conversations',
    [
      body('portfolio_id').isInt({ min: 1 }).toInt(),
      ...interestIdsValidation,
    ],
    async (req, res) => {
      if (sendValidationErrors(req, res)) return;
      try {
        const conversation = await workflow.createManagedConversation({
          database,
          managerId: Number(req.user.id),
          portfolioId: req.body.portfolio_id,
          interestIds: req.body.interest_ids,
        });
        return res.status(201).json(conversation);
      } catch (error) {
        return sendWorkflowError(error, res);
      }
    },
  );

  router.post(
    '/conversations/:conversationId/investors',
    [
      param('conversationId').isInt({ min: 1 }).toInt(),
      ...interestIdsValidation,
    ],
    async (req, res) => {
      if (sendValidationErrors(req, res)) return;
      try {
        return res.json(await workflow.addManagedInvestors({
          database,
          managerId: Number(req.user.id),
          conversationId: req.params.conversationId,
          interestIds: req.body.interest_ids,
        }));
      } catch (error) {
        return sendWorkflowError(error, res);
      }
    },
  );

  for (const [action, handlerName] of [
    ['archive', 'archiveManagedConversation'],
    ['reopen', 'reopenManagedConversation'],
  ]) {
    router.put(
      `/conversations/:conversationId/${action}`,
      param('conversationId').isInt({ min: 1 }).toInt(),
      async (req, res) => {
        if (sendValidationErrors(req, res)) return;
        try {
          return res.json(await workflow[handlerName]({
            database,
            managerId: Number(req.user.id),
            conversationId: req.params.conversationId,
          }));
        } catch (error) {
          return sendWorkflowError(error, res);
        }
      },
    );
  }

  return router;
}

module.exports = createRelationshipManagerRouter();
module.exports.createRelationshipManagerRouter = createRelationshipManagerRouter;
module.exports.loadDashboard = loadDashboard;

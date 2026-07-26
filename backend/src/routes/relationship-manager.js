const express = require('express');
const { body, param, validationResult } = require('express-validator');
const defaultDatabase = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const managedConversationWorkflow = require('../services/managed-conversation-workflow');
const relationshipManagerReadModel = require('../services/relationship-manager-read-model');

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

function createRelationshipManagerRouter({
  database = defaultDatabase,
  workflows = managedConversationWorkflow,
  workflow,
  readModel = relationshipManagerReadModel,
} = {}) {
  const conversationWorkflows = {
    ...managedConversationWorkflow,
    ...workflows,
    ...workflow,
  };
  const reads = {
    ...relationshipManagerReadModel,
    ...readModel,
  };
  const router = express.Router();
  router.use(authenticate, requireRole('relationship_manager'));

  router.get('/dashboard', async (req, res) => {
    try {
      return res.json(await reads.loadRelationshipManagerDashboard({
        database,
        managerId: Number(req.user.id),
      }));
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  router.get(
    '/portfolios/:portfolioId',
    param('portfolioId')
      .custom((value) => (
        /^[1-9]\d*$/.test(String(value))
        && Number.isSafeInteger(Number(value))
      ))
      .withMessage('Portfolio ID must be a positive integer')
      .toInt(),
    async (req, res) => {
      if (sendValidationErrors(req, res)) return;
      try {
        return res.json(await reads.loadAssignedPortfolio({
          database,
          managerId: Number(req.user.id),
          portfolioId: req.params.portfolioId,
        }));
      } catch (error) {
        if (error instanceof relationshipManagerReadModel.RelationshipManagerReadError) {
          return res.status(error.status).json({ error: error.message });
        }
        console.error(error);
        return res.status(500).json({ error: 'Server error' });
      }
    },
  );

  router.post(
    '/conversations',
    [
      body('portfolio_id').isInt({ min: 1 }).toInt(),
      ...interestIdsValidation,
    ],
    async (req, res) => {
      if (sendValidationErrors(req, res)) return;
      try {
        const conversation = await conversationWorkflows.createManagedConversation({
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
        return res.json(await conversationWorkflows.addManagedInvestors({
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
          return res.json(await conversationWorkflows[handlerName]({
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

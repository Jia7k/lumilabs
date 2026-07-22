const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { ManagedConversationError } = require('../services/managed-conversation-workflow');
const {
  listAccessibleConversations,
  loadConversationThread,
  markConversationRead,
  sendConversationMessage,
} = require('../services/group-message-workflow');

const router = express.Router();

const conversationIdValidation = param('conversationId').isInt({ min: 1 }).toInt();

function sendValidationErrors(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ errors: errors.array() });
  return true;
}

function sendWorkflowError(error, res) {
  if (error instanceof ManagedConversationError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(error);
  return res.status(500).json({ error: 'Server error' });
}

// GET /api/messages/me — current authenticated message user
router.get('/me', authenticate, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role,
  });
});

// GET /api/messages/conversations — rooms where the user is an active member
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const conversations = await listAccessibleConversations({
      database: db,
      userId: req.user.id,
    });
    return res.json(conversations);
  } catch (error) {
    return sendWorkflowError(error, res);
  }
});

// GET /api/messages/conversations/:conversationId — visible room history
router.get(
  '/conversations/:conversationId',
  authenticate,
  conversationIdValidation,
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      const thread = await loadConversationThread({
        database: db,
        userId: req.user.id,
        conversationId: req.params.conversationId,
      });
      return res.json(thread);
    } catch (error) {
      return sendWorkflowError(error, res);
    }
  },
);

// PUT /api/messages/conversations/:conversationId/read — advance this member's cursor
router.put(
  '/conversations/:conversationId/read',
  authenticate,
  [
    conversationIdValidation,
    body('message_id').isInt({ min: 1 }).toInt(),
  ],
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      const cursor = await markConversationRead({
        database: db,
        userId: req.user.id,
        conversationId: req.params.conversationId,
        messageId: req.body.message_id,
      });
      return res.json(cursor);
    } catch (error) {
      return sendWorkflowError(error, res);
    }
  },
);

// POST /api/messages/conversations/:conversationId/messages — send to every active member
router.post(
  '/conversations/:conversationId/messages',
  authenticate,
  [
    conversationIdValidation,
    body('content').trim().notEmpty().isLength({ max: 2000 }),
  ],
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      const message = await sendConversationMessage({
        database: db,
        user: req.user,
        conversationId: req.params.conversationId,
        content: req.body.content,
      });
      return res.status(201).json(message);
    } catch (error) {
      return sendWorkflowError(error, res);
    }
  },
);

module.exports = router;

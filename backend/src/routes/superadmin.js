const express = require('express');
const {
  body,
  param,
  query: queryParameter,
  validationResult,
} = require('express-validator');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  SuperadminAssignmentError,
} = require('../services/superadmin-assignment-workflow');
const {
  StaffProvisioningError,
} = require('../services/staff-provisioning-workflow');

function isPositiveSafeInteger(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function positiveSafeInteger(location, field) {
  return location(field)
    .custom(isPositiveSafeInteger)
    .toInt();
}

function sendValidationErrors(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ errors: errors.array() });
  return true;
}

function sendWorkflowError(error, res, ErrorClass) {
  if (
    error instanceof ErrorClass
    && Number.isInteger(error.status)
    && error.status >= 400
    && error.status < 500
  ) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
    });
  }
  console.error('Superadmin workflow failed');
  return res.status(500).json({ error: 'Server error' });
}

function sendReadError(error, res) {
  console.error(error);
  return res.status(500).json({ error: 'Server error' });
}

function createSuperadminRouter({
  database,
  assignmentWorkflow = require('../services/superadmin-assignment-workflow'),
  provisioningWorkflow = require('../services/staff-provisioning-workflow'),
  readModel = require('../services/superadmin-read-model'),
} = {}) {
  const router = express.Router();
  router.use(authenticate, requireRole('superadmin'));

  router.get('/stats', async (req, res) => {
    try {
      return res.json(await readModel.loadSuperadminStats(database));
    } catch (error) {
      return sendReadError(error, res);
    }
  });

  router.get('/portfolio-assignments', async (req, res) => {
    try {
      return res.json(await readModel.listPortfolioAssignments(database));
    } catch (error) {
      return sendReadError(error, res);
    }
  });

  router.get('/relationship-managers', async (req, res) => {
    try {
      return res.json(await readModel.listRelationshipManagers(database));
    } catch (error) {
      return sendReadError(error, res);
    }
  });

  router.get('/staff', async (req, res) => {
    try {
      return res.json(await readModel.listStaff(database));
    } catch (error) {
      return sendReadError(error, res);
    }
  });

  router.post('/staff', async (req, res) => {
    try {
      const staff = await provisioningWorkflow.createStaffAccount({
        database,
        superadminId: Number(req.user.id),
        name: req.body.name,
        email: req.body.email,
        password: req.body.password,
        role: req.body.role,
      });
      return res.status(201).json(staff);
    } catch (error) {
      return sendWorkflowError(
        error,
        res,
        StaffProvisioningError,
      );
    }
  });

  router.put(
    '/portfolios/:id/assignment',
    [
      positiveSafeInteger(param, 'id'),
      positiveSafeInteger(body, 'relationship_manager_id'),
    ],
    async (req, res) => {
      if (sendValidationErrors(req, res)) return;
      try {
        return res.json(await assignmentWorkflow.assignPortfolio({
          database,
          superadminId: Number(req.user.id),
          portfolioId: req.params.id,
          relationshipManagerId: req.body.relationship_manager_id,
        }));
      } catch (error) {
        return sendWorkflowError(
          error,
          res,
          SuperadminAssignmentError,
        );
      }
    },
  );

  router.delete(
    '/portfolios/:id/assignment',
    positiveSafeInteger(param, 'id'),
    async (req, res) => {
      if (sendValidationErrors(req, res)) return;
      try {
        return res.json(await assignmentWorkflow.unassignPortfolio({
          database,
          superadminId: Number(req.user.id),
          portfolioId: req.params.id,
        }));
      } catch (error) {
        return sendWorkflowError(
          error,
          res,
          SuperadminAssignmentError,
        );
      }
    },
  );

  router.get(
    '/audit-logs',
    [
      positiveSafeInteger(queryParameter, 'page').optional(),
      queryParameter('limit')
        .optional()
        .custom((value) => isPositiveSafeInteger(value) && Number(value) <= 100)
        .toInt(),
    ],
    async (req, res) => {
      if (sendValidationErrors(req, res)) return;
      const page = req.query.page === undefined ? 1 : req.query.page;
      const limit = req.query.limit === undefined ? 50 : req.query.limit;
      if (!Number.isSafeInteger((page - 1) * limit)) {
        return res.status(400).json({
          errors: [{
            type: 'field',
            value: req.query.page,
            msg: 'Pagination offset exceeds safe integer range',
            path: 'page',
            location: 'query',
          }],
        });
      }
      try {
        return res.json(await readModel.listSuperadminAuditLogs(
          database,
          { page, limit },
        ));
      } catch (error) {
        return sendReadError(error, res);
      }
    },
  );

  return router;
}

module.exports = {
  createSuperadminRouter,
};

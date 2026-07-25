const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/superadmin/stats
router.get('/stats', authenticate, requireRole('superadmin'), async (req, res) => {
  try {
    const [[{ business_owners }]] = await db.query(
      "SELECT COUNT(*) AS business_owners FROM users WHERE role='business_owner'"
    );
    const [[{ investors }]] = await db.query(
      "SELECT COUNT(*) AS investors FROM users WHERE role='investor'"
    );
    const [[{ admins }]] = await db.query(
      "SELECT COUNT(*) AS admins FROM users WHERE role='admin'"
    );
    const [[{ relationship_managers }]] = await db.query(
      "SELECT COUNT(*) AS relationship_managers FROM users WHERE role='relationship_manager'"
    );

    // Number of portfolios each RM currently manages
    const [workload] = await db.query(
      `SELECT u.id, u.name, u.email,
              COUNT(p.id) AS portfolio_count
       FROM users u
       LEFT JOIN portfolios p ON p.relationship_manager_id = u.id
       WHERE u.role = 'relationship_manager'
       GROUP BY u.id, u.name, u.email
       ORDER BY portfolio_count DESC`
    );

    res.json({
      business_owners,
      investors,
      admins,
      relationship_managers,
      rm_workload: workload,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/superadmin/portfolio-assignments
// Approved portfolios with their currently assigned RM, if any
router.get('/portfolio-assignments', authenticate, requireRole('superadmin'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.name, u.name AS owner_name,
              rm.id AS rm_id, rm.name AS rm_name
       FROM portfolios p
       JOIN users u ON u.id = p.owner_id
       LEFT JOIN users rm ON rm.id = p.relationship_manager_id
       WHERE p.status = 'approved'
       ORDER BY p.name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
 
// GET /api/superadmin/relationship-managers
// For the assign/change dropdown
router.get('/relationship-managers', authenticate, requireRole('superadmin'), async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, email FROM users WHERE role='relationship_manager' ORDER BY name ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
 
// PUT /api/superadmin/portfolios/:id/assign
router.put(
  '/portfolios/:id/assign',
  authenticate,
  requireRole('superadmin'),
  [body('relationship_manager_id').isInt()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
 
    try {
      const [portfolioRows] = await db.query(
        "SELECT * FROM portfolios WHERE id = ? AND status = 'approved'",
        [req.params.id]
      );
      if (portfolioRows.length === 0) {
        return res.status(404).json({ error: 'Approved portfolio not found' });
      }
 
      const [rmRows] = await db.query(
        "SELECT * FROM users WHERE id = ? AND role = 'relationship_manager'",
        [req.body.relationship_manager_id]
      );
      if (rmRows.length === 0) {
        return res.status(404).json({ error: 'Relationship manager not found' });
      }
 
      await db.query(
        'UPDATE portfolios SET relationship_manager_id = ? WHERE id = ?',
        [req.body.relationship_manager_id, req.params.id]
      );
 
      res.json({ message: 'Portfolio assigned' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
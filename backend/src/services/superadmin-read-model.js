function asNumber(value) {
  return Number(value || 0);
}

function publicAccount(row) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function assignmentActions(row) {
  return {
    can_assign: row.status === 'approved' && row.relationship_manager_id === null,
    assign_disabled_reason:
      row.status !== 'approved'
        ? 'Portfolio must be approved before assignment'
        : null,
    can_reassign:
      row.status === 'approved' && row.relationship_manager_id !== null,
    reassign_disabled_reason:
      row.status !== 'approved'
        ? 'Portfolio must be approved before reassignment'
        : null,
    can_unassign:
      row.relationship_manager_id !== null && row.conversation_id === null,
    unassign_disabled_reason:
      row.conversation_id !== null
        ? 'Reassign required because this portfolio already has a chat'
        : null,
  };
}

async function loadSuperadminStats(database) {
  const [[roleTotals = {}]] = await database.query(
    `SELECT COUNT(CASE WHEN role='business_owner' THEN 1 END) AS business_owners,
            COUNT(CASE WHEN role='investor' THEN 1 END) AS investors,
            COUNT(CASE WHEN role='relationship_manager' THEN 1 END)
              AS relationship_managers,
            COUNT(CASE WHEN role='admin' THEN 1 END) AS admins,
            COUNT(CASE WHEN role='superadmin' THEN 1 END) AS superadmins
       FROM users`,
  );
  const [[portfolioTotals = {}]] = await database.query(
    `SELECT COUNT(CASE WHEN status='approved' THEN 1 END)
              AS approved_portfolios,
            COUNT(CASE WHEN status='approved'
                        AND relationship_manager_id IS NULL
                       THEN 1 END) AS unassigned_portfolios,
            COUNT(CASE WHEN relationship_manager_id IS NOT NULL THEN 1 END)
              AS assigned_portfolios
       FROM portfolios`,
  );
  const [workloadRows] = await database.query(
    `SELECT u.id,u.name,u.email,
            COUNT(DISTINCT p.id) AS assigned_portfolios,
            COUNT(DISTINCT CASE WHEN c.status='active' THEN c.id END)
              AS active_rooms
       FROM users u
       LEFT JOIN portfolios p ON p.relationship_manager_id=u.id
       LEFT JOIN conversations c
         ON c.portfolio_id=p.id
        AND c.relationship_manager_id=u.id
      WHERE u.role='relationship_manager'
      GROUP BY u.id,u.name,u.email
      ORDER BY assigned_portfolios DESC,u.name,u.id`,
  );

  return {
    business_owners: asNumber(roleTotals.business_owners),
    investors: asNumber(roleTotals.investors),
    relationship_managers: asNumber(roleTotals.relationship_managers),
    admins: asNumber(roleTotals.admins),
    superadmins: asNumber(roleTotals.superadmins),
    approved_portfolios: asNumber(portfolioTotals.approved_portfolios),
    unassigned_portfolios: asNumber(portfolioTotals.unassigned_portfolios),
    assigned_portfolios: asNumber(portfolioTotals.assigned_portfolios),
    rm_workload: workloadRows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      email: row.email,
      assigned_portfolios: asNumber(row.assigned_portfolios),
      active_rooms: asNumber(row.active_rooms),
    })),
  };
}

async function listPortfolioAssignments(database) {
  const [rows] = await database.query(
    `SELECT p.id,p.name,p.status,
            owner.id AS owner_id,
            owner.name AS owner_name,
            owner.email AS owner_email,
            rm.id AS relationship_manager_id,
            rm.name AS relationship_manager_name,
            rm.email AS relationship_manager_email,
            c.id AS conversation_id,
            c.status AS conversation_status,
            c.archived_reason AS conversation_archived_reason
       FROM portfolios p
       JOIN users owner ON owner.id=p.owner_id
       LEFT JOIN users rm ON rm.id=p.relationship_manager_id
       LEFT JOIN conversations c ON c.portfolio_id=p.id
      WHERE p.status='approved' OR p.relationship_manager_id IS NOT NULL
      ORDER BY p.name,p.id`,
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    status: row.status,
    owner: {
      id: Number(row.owner_id),
      name: row.owner_name,
      email: row.owner_email,
    },
    relationship_manager:
      row.relationship_manager_id === null
        ? null
        : {
          id: Number(row.relationship_manager_id),
          name: row.relationship_manager_name,
          email: row.relationship_manager_email,
        },
    conversation:
      row.conversation_id === null
        ? null
        : {
          id: Number(row.conversation_id),
          status: row.conversation_status,
          archived_reason: row.conversation_archived_reason || null,
        },
    actions: assignmentActions(row),
  }));
}

async function listRelationshipManagers(database) {
  const [rows] = await database.query(
    `SELECT id,name,email,role,created_at,updated_at
       FROM users
      WHERE role='relationship_manager'
      ORDER BY name,id`,
  );
  return rows.map(publicAccount);
}

async function listStaff(database) {
  const [rows] = await database.query(
    `SELECT id,name,email,role,created_at,updated_at
       FROM users
      WHERE role IN ('admin','relationship_manager')
      ORDER BY role,name,id`,
  );
  return rows.map(publicAccount);
}

async function listSuperadminAuditLogs(database, { page, limit }) {
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    throw new RangeError('Pagination offset exceeds safe integer range');
  }
  const [[countRow = {}]] = await database.query(
    'SELECT COUNT(*) AS total FROM superadmin_audit_logs',
  );
  const total = asNumber(countRow.total);
  const [auditRows] = await database.query(
    `SELECT CAST(sal.id AS CHAR) AS id,
            sal.superadmin_id_snapshot,
            sal.superadmin_name_snapshot,
            sal.superadmin_email_snapshot,
            sal.action,
            sal.portfolio_id_snapshot,
            sal.portfolio_name_snapshot,
            sal.previous_relationship_manager_id_snapshot,
            sal.previous_relationship_manager_name_snapshot,
            sal.previous_relationship_manager_email_snapshot,
            sal.new_relationship_manager_id_snapshot,
            sal.new_relationship_manager_name_snapshot,
            sal.new_relationship_manager_email_snapshot,
            sal.created_user_id_snapshot,
            sal.created_user_name_snapshot,
            sal.created_user_email_snapshot,
            sal.created_user_role,
            sal.created_at
       FROM superadmin_audit_logs sal
      ORDER BY sal.created_at DESC,sal.id DESC
      LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  return {
    items: auditRows,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  };
}

module.exports = {
  assignmentActions,
  loadSuperadminStats,
  listPortfolioAssignments,
  listRelationshipManagers,
  listStaff,
  listSuperadminAuditLogs,
};

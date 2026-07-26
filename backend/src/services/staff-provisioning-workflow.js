const bcrypt = require('bcryptjs');

class StaffProvisioningError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'StaffProvisioningError';
    this.status = status;
    this.code = code;
  }
}

function normalizeStaffInput({ name, email, password, role }) {
  const normalized = {
    name: typeof name === 'string' ? name.trim() : '',
    email: typeof email === 'string' ? email.trim().toLowerCase() : '',
    password: typeof password === 'string' ? password : '',
    role,
  };
  if (normalized.name.length < 1 || normalized.name.length > 100) {
    throw new StaffProvisioningError(
      400,
      'Name must be 1 to 100 characters',
      'INVALID_NAME',
    );
  }
  if (
    normalized.email.length > 255
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)
  ) {
    throw new StaffProvisioningError(
      400,
      'A valid email is required',
      'INVALID_EMAIL',
    );
  }
  if (normalized.password.length < 6 || normalized.password.length > 128) {
    throw new StaffProvisioningError(
      400,
      'Password must be 6 to 128 characters',
      'INVALID_PASSWORD',
    );
  }
  if (!['admin', 'relationship_manager'].includes(normalized.role)) {
    throw new StaffProvisioningError(
      400,
      'Role must be admin or relationship_manager',
      'INVALID_STAFF_ROLE',
    );
  }
  return normalized;
}

function requireSuperadminId(superadminId) {
  if (!Number.isSafeInteger(superadminId) || superadminId <= 0) {
    throw new StaffProvisioningError(
      403,
      'Superadmin access required',
      'SUPERADMIN_REQUIRED',
    );
  }
  return superadminId;
}

function duplicateEmailError() {
  return new StaffProvisioningError(
    409,
    'Email already registered',
    'DUPLICATE_EMAIL',
  );
}

function unexpectedProvisioningError() {
  return new StaffProvisioningError(
    500,
    'Staff account could not be created',
    'STAFF_PROVISIONING_FAILED',
  );
}

function translateError(error) {
  if (error instanceof StaffProvisioningError) return error;
  if (error && error.code === 'ER_DUP_ENTRY') return duplicateEmailError();
  return unexpectedProvisioningError();
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

function publicStaff(staff) {
  return {
    id: Number(staff.id),
    name: staff.name,
    email: staff.email,
    role: staff.role,
    created_at: staff.created_at,
  };
}

async function createStaffAccount({
  database,
  superadminId: superadminIdValue,
  name,
  email,
  password,
  role,
  hashPassword = (value) => bcrypt.hash(value, 10),
}) {
  const normalized = normalizeStaffInput({ name, email, password, role });
  const superadminId = requireSuperadminId(superadminIdValue);
  const passwordHash = await hashPassword(normalized.password);
  let connection;
  try {
    connection = await database.getConnection();
  } catch (error) {
    throw translateError(error);
  }
  let operationError = null;
  let connectionReusable = true;

  try {
    await connection.beginTransaction();

    const actors = await queryRows(
      connection,
      'SELECT id,name,email,role FROM users WHERE id=? FOR UPDATE',
      [superadminId],
    );
    const superadmin = actors[0];
    if (!superadmin || superadmin.role !== 'superadmin') {
      throw new StaffProvisioningError(
        403,
        'Superadmin access required',
        'SUPERADMIN_REQUIRED',
      );
    }

    const existing = await queryRows(
      connection,
      'SELECT id FROM users WHERE email=? FOR UPDATE',
      [normalized.email],
    );
    if (existing.length) throw duplicateEmailError();

    const [insertResult] = await connection.execute(
      'INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?)',
      [
        normalized.email,
        passwordHash,
        normalized.name,
        normalized.role,
      ],
    );
    const createdRows = await queryRows(
      connection,
      'SELECT id,name,email,role,created_at FROM users WHERE id=?',
      [insertResult.insertId],
    );
    if (createdRows.length !== 1) {
      throw new Error('Created staff account could not be read');
    }
    const created = publicStaff(createdRows[0]);
    const action = normalized.role === 'admin'
      ? 'admin_account_created'
      : 'relationship_manager_account_created';
    const [auditResult] = await connection.query(
      `INSERT INTO superadmin_audit_logs
        (superadmin_id,
         superadmin_id_snapshot,
         superadmin_name_snapshot,
         superadmin_email_snapshot,
         action,
         created_user_id,
         created_user_id_snapshot,
         created_user_name_snapshot,
         created_user_email_snapshot,
         created_user_role)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        Number(superadmin.id),
        Number(superadmin.id),
        superadmin.name,
        superadmin.email,
        action,
        created.id,
        created.id,
        created.name,
        created.email,
        created.role,
      ],
    );
    if (!auditResult || Number(auditResult.affectedRows) !== 1) {
      throw new Error('Staff provisioning audit could not be written');
    }

    await connection.commit();
    return created;
  } catch (error) {
    operationError = translateError(error);
    try {
      await connection.rollback();
    } catch {
      connectionReusable = false;
      try {
        await connection.destroy();
      } catch {
        // A failed rollback connection must never return to the pool.
      }
    }
    throw operationError;
  } finally {
    if (connectionReusable) {
      try {
        await connection.release();
      } catch (error) {
        if (!operationError) throw translateError(error);
      }
    }
  }
}

module.exports = {
  StaffProvisioningError,
  createStaffAccount,
};

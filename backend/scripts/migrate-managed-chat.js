const {
  verifyPreservedCoreSchema,
  verifySchema,
} = require('../src/schema-contract');

const CHAT_RESET_CONFIRMATION = 'RESET_LUMILABS_CHAT_ONLY_20260722';
const BACKUP_CONFIRMATION = 'BACKUP_AND_RESTORE_COMMAND_VERIFIED';

const NOTIFICATION_TYPES = [
  'new_message',
  'new_interest',
  'portfolio_approved',
  'portfolio_rejected',
  'portfolio_needs_changes',
  'portfolio_submitted',
  'conversation_created',
  'conversation_member_added',
  'conversation_archived',
];

const CREATE_CONVERSATIONS = `
  CREATE TABLE conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    portfolio_id INT NULL,
    relationship_manager_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    status ENUM('active','archived') NOT NULL DEFAULT 'active',
    archived_reason ENUM('manual','no_active_investors','portfolio_unapproved','portfolio_deleted') NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_conversation_portfolio (portfolio_id),
    CONSTRAINT fk_conversations_portfolio FOREIGN KEY (portfolio_id)
      REFERENCES portfolios(id) ON DELETE SET NULL,
    CONSTRAINT fk_conversations_manager FOREIGN KEY (relationship_manager_id)
      REFERENCES users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`;

const CREATE_MEMBERS = `
  CREATE TABLE conversation_members (
    conversation_id INT NOT NULL,
    user_id INT NOT NULL,
    member_role ENUM('relationship_manager','business_owner','investor') NOT NULL,
    singleton_role VARCHAR(24)
      GENERATED ALWAYS AS (
        CASE WHEN member_role IN ('relationship_manager','business_owner')
          THEN member_role ELSE NULL END
      ) STORED,
    membership_status ENUM('active','removed') NOT NULL DEFAULT 'active',
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP NULL,
    visible_after_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id),
    UNIQUE KEY unique_conversation_singleton (conversation_id, singleton_role),
    KEY idx_members_user_status (user_id, membership_status),
    CONSTRAINT fk_members_conversation FOREIGN KEY (conversation_id)
      REFERENCES conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_members_user FOREIGN KEY (user_id)
      REFERENCES users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`;

const CREATE_MESSAGES = `
  CREATE TABLE messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    sender_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_messages_conversation_id (conversation_id, id),
    CONSTRAINT fk_messages_member FOREIGN KEY (conversation_id, sender_id)
      REFERENCES conversation_members(conversation_id, user_id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`;

function assertMigrationGuards(environment) {
  if (environment.CHAT_BACKUP_VERIFIED !== BACKUP_CONFIRMATION) {
    throw new Error('Verified chat backup is required before migration');
  }
  if (environment.CONFIRM_CHAT_RESET !== CHAT_RESET_CONFIRMATION) {
    throw new Error('Exact chat reset confirmation is required');
  }
  return true;
}

function quoteIdentifier(value) {
  const identifier = String(value);
  if (!/^[A-Za-z0-9_$]+$/.test(identifier)) {
    throw new Error(`Unsafe database identifier: ${identifier}`);
  }
  return `\`${identifier}\``;
}

async function rows(database, sql, params = []) {
  const [result] = await database.query(sql, params);
  return result;
}

async function count(database, sql, params = []) {
  const result = await rows(database, sql, params);
  return Number(result[0]?.count || 0);
}

function enumValues(columnType) {
  return [...String(columnType || '').matchAll(/'((?:''|[^'])*)'/g)]
    .map((match) => match[1].replaceAll("''", "'"));
}

function chatNotificationCondition(notificationColumns, alias = 'n') {
  const prefix = alias ? `${alias}.` : '';
  const conditions = [
    `${prefix}type IN ('new_message','conversation_created','conversation_member_added','conversation_archived')`,
  ];
  if (notificationColumns.has('related_conversation_id')) {
    conditions.push(`${prefix}related_conversation_id IS NOT NULL`);
  }
  if (notificationColumns.has('related_message_id')) {
    conditions.push(`${prefix}related_message_id IS NOT NULL`);
  }
  return `(${conditions.join(' OR ')})`;
}

async function readProtectedCounts(database, notificationColumns) {
  const protectedTables = [
    'users',
    'portfolios',
    'portfolio_documents',
    'investor_interests',
    'audit_logs',
  ];
  const result = {};
  for (const table of protectedTables) {
    result[table] = await count(
      database,
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`,
    );
  }
  result.unrelated_notifications = await count(
    database,
    `SELECT COUNT(*) AS count
       FROM notifications n
      WHERE NOT ${chatNotificationCondition(notificationColumns)}`,
  );
  return result;
}

async function unrelatedNotificationIdentities(database, notificationColumns) {
  const identities = await rows(
    database,
    `SELECT id,type FROM notifications n
      WHERE NOT ${chatNotificationCondition(notificationColumns)}
      ORDER BY id`,
  );
  return identities.map(({ id, type }) => ({ id: Number(id), type }));
}

function assertUnrelatedNotificationIdentities(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Unrelated notification identities changed during migration');
  }
}

async function ensureColumn(database, table, column, definition) {
  const existing = await rows(
    database,
    `SELECT COLUMN_NAME
       FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name=? AND column_name=?
      LIMIT 1`,
    [table, column],
  );
  if (existing.length) return;
  await database.query(
    `ALTER TABLE ${quoteIdentifier(table)}
       ADD COLUMN ${quoteIdentifier(column)} ${definition}`,
  );
}

async function ensureIndex(database, table, name, definition) {
  const existing = await rows(
    database,
    `SELECT INDEX_NAME
       FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name=? AND index_name=?
      LIMIT 1`,
    [table, name],
  );
  if (existing.length) return;
  await database.query(
    `ALTER TABLE ${quoteIdentifier(table)} ADD ${definition}`,
  );
}

async function ensureForeignKey(database, table, name, definition) {
  const existing = await rows(
    database,
    `SELECT CONSTRAINT_NAME
       FROM information_schema.table_constraints
      WHERE constraint_schema=DATABASE()
        AND table_name=?
        AND constraint_name=?
        AND constraint_type='FOREIGN KEY'
      LIMIT 1`,
    [table, name],
  );
  if (existing.length) return;
  await database.query(
    `ALTER TABLE ${quoteIdentifier(table)}
       ADD CONSTRAINT ${quoteIdentifier(name)} ${definition}`,
  );
}

function assertProtectedCounts(before, after) {
  const changed = Object.keys(before).filter((key) => before[key] !== after[key]);
  if (changed.length) {
    const details = changed.map((key) => `${key}: ${before[key]} -> ${after[key]}`);
    throw new Error(`Protected row counts changed: ${details.join(', ')}`);
  }
}

async function migrateManagedChat(database, environment = process.env) {
  assertMigrationGuards(environment);
  await verifyPreservedCoreSchema(database);

  const requiredTables = [
    'users',
    'portfolios',
    'portfolio_documents',
    'investor_interests',
    'notifications',
    'audit_logs',
  ];
  const tableRows = await rows(
    database,
    `SELECT TABLE_NAME AS table_name
       FROM information_schema.tables
      WHERE table_schema=DATABASE()`,
  );
  const tables = new Set(tableRows.map((row) => row.table_name || row.TABLE_NAME));
  const missingTables = requiredTables.filter((table) => !tables.has(table));
  if (missingTables.length) {
    throw new Error(`Migration preflight missing tables: ${missingTables.join(', ')}`);
  }

  const roleRows = await rows(database, 'SELECT DISTINCT role FROM users');
  const allowedRoles = new Set(['business_owner', 'investor', 'relationship_manager', 'admin']);
  const unexpectedRoles = roleRows
    .map((row) => row.role)
    .filter((role) => !allowedRoles.has(role));
  if (unexpectedRoles.length) {
    throw new Error(`Migration preflight found unsupported user roles: ${unexpectedRoles.join(', ')}`);
  }

  const notificationColumnRows = await rows(
    database,
    `SELECT COLUMN_NAME AS column_name,COLUMN_TYPE AS column_type
       FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='notifications'`,
  );
  const notificationColumnsBefore = new Set(
    notificationColumnRows.map((row) => row.column_name || row.COLUMN_NAME),
  );
  const notificationTypeColumn = notificationColumnRows.find((row) => (
    (row.column_name || row.COLUMN_NAME) === 'type'
  ));
  const configuredNotificationTypes = enumValues(
    notificationTypeColumn?.column_type || notificationTypeColumn?.COLUMN_TYPE,
  );
  const unsupportedConfiguredTypes = configuredNotificationTypes.filter(
    (type) => !NOTIFICATION_TYPES.includes(type),
  );
  const notificationTypeRows = await rows(
    database,
    'SELECT DISTINCT type FROM notifications',
  );
  const unsupportedStoredTypes = notificationTypeRows
    .map((row) => row.type)
    .filter((type) => !NOTIFICATION_TYPES.includes(type));
  if (unsupportedConfiguredTypes.length || unsupportedStoredTypes.length) {
    const unexpected = [...new Set([
      ...unsupportedConfiguredTypes,
      ...unsupportedStoredTypes,
    ])];
    throw new Error(
      `Migration preflight found unsupported notification types: ${unexpected.join(', ')}`,
    );
  }
  const before = await readProtectedCounts(database, notificationColumnsBefore);
  const unrelatedBefore = await unrelatedNotificationIdentities(
    database,
    notificationColumnsBefore,
  );
  const chatCondition = chatNotificationCondition(notificationColumnsBefore, 'notifications');
  const [deletedNotifications] = await database.query(
    `DELETE FROM notifications WHERE ${chatCondition}`,
  );

  const notificationForeignKeys = await rows(
    database,
    `SELECT DISTINCT CONSTRAINT_NAME AS constraint_name
       FROM information_schema.key_column_usage
      WHERE table_schema=DATABASE()
        AND table_name='notifications'
        AND referenced_table_name IN ('messages','conversations')`,
  );
  for (const foreignKey of notificationForeignKeys) {
    const name = foreignKey.constraint_name || foreignKey.CONSTRAINT_NAME;
    await database.query(
      `ALTER TABLE notifications DROP FOREIGN KEY ${quoteIdentifier(name)}`,
    );
  }

  await database.query('DROP TABLE IF EXISTS messages');
  await database.query('DROP TABLE IF EXISTS conversation_members');
  await database.query('DROP TABLE IF EXISTS conversations');

  await database.query(
    `ALTER TABLE users
       MODIFY role ENUM('business_owner','investor','relationship_manager','admin')
       NOT NULL DEFAULT 'business_owner'`,
  );
  await database.query(CREATE_CONVERSATIONS);
  await database.query(CREATE_MEMBERS);
  await database.query(CREATE_MESSAGES);

  await ensureColumn(
    database,
    'notifications',
    'related_conversation_id',
    'INT NULL AFTER related_portfolio_id',
  );
  await ensureColumn(
    database,
    'notifications',
    'related_message_id',
    'INT NULL AFTER related_conversation_id',
  );
  await database.query(
    `ALTER TABLE notifications
       MODIFY type ENUM(${NOTIFICATION_TYPES.map((type) => `'${type}'`).join(',')}) NOT NULL`,
  );

  await ensureIndex(
    database,
    'notifications',
    'idx_notifications_conversation',
    'KEY idx_notifications_conversation (related_conversation_id)',
  );
  await ensureIndex(
    database,
    'notifications',
    'idx_notifications_message',
    'KEY idx_notifications_message (related_message_id)',
  );
  await ensureForeignKey(
    database,
    'notifications',
    'fk_notifications_conversation',
    'FOREIGN KEY (related_conversation_id) REFERENCES conversations(id) ON DELETE SET NULL',
  );
  await ensureForeignKey(
    database,
    'notifications',
    'fk_notifications_message',
    'FOREIGN KEY (related_message_id) REFERENCES messages(id) ON DELETE SET NULL',
  );

  await verifySchema(database);
  const notificationColumnsAfter = new Set([
    ...notificationColumnsBefore,
    'related_conversation_id',
    'related_message_id',
  ]);
  const after = await readProtectedCounts(database, notificationColumnsAfter);
  const unrelatedAfter = await unrelatedNotificationIdentities(
    database,
    notificationColumnsAfter,
  );
  assertProtectedCounts(before, after);
  assertUnrelatedNotificationIdentities(unrelatedBefore, unrelatedAfter);

  return {
    before,
    after,
    deleted_chat_notifications: Number(deletedNotifications.affectedRows || 0),
  };
}

module.exports = {
  BACKUP_CONFIRMATION,
  CHAT_RESET_CONFIRMATION,
  assertMigrationGuards,
  ensureColumn,
  migrateManagedChat,
};

const {
  EXPECTED_SCHEMA,
  FINAL_NOTIFICATION_COLUMN_TYPE,
  FINAL_ROLE_COLUMN_TYPE,
  verifyPreservedCoreSchema,
  verifySchema,
} = require('../src/schema-contract');

const BACKUP_CONFIRMATION = 'BACKUP_AND_RESTORE_COMMAND_VERIFIED';
const MIGRATION_CONFIRMATION =
  'APPLY_LUMILABS_FIVE_ROLE_WORKFLOW_20260727';
const MIGRATION_LOCK = 'lumilabs-five-role-workflow-20260727';
const PRIOR_ROLE_COLUMN_TYPE =
  "enum('business_owner','investor','relationship_manager','admin')";
const PRIOR_NOTIFICATION_COLUMN_TYPE =
  "enum('new_message','new_interest','portfolio_approved','portfolio_rejected',"
  + "'portfolio_needs_changes','portfolio_submitted','conversation_created',"
  + "'conversation_member_added','conversation_archived')";
const PRIOR_SINGLETON_GENERATION_EXPRESSION =
  "(case when (`member_role` in (_utf8mb4'relationship_manager',"
  + "_utf8mb4'business_owner')) then `member_role` else NULL end)";
const FINAL_SINGLETON_GENERATION_EXPRESSION =
  "(case when ((`membership_status` = _utf8mb4'active') and "
  + "(`member_role` in (_utf8mb4'relationship_manager',"
  + "_utf8mb4'business_owner'))) then `member_role` else NULL end)";

const SUPERADMIN_AUDIT_INDEXES = new Map([
  ['PRIMARY', { unique: true, columns: ['id'] }],
  [
    'idx_superadmin_audit_actor',
    { unique: false, columns: ['superadmin_id', 'created_at'] },
  ],
  [
    'idx_superadmin_audit_action',
    { unique: false, columns: ['action', 'created_at'] },
  ],
  [
    'idx_superadmin_audit_portfolio',
    { unique: false, columns: ['portfolio_id', 'created_at'] },
  ],
  [
    'idx_superadmin_audit_previous_manager',
    { unique: false, columns: ['previous_relationship_manager_id'] },
  ],
  [
    'idx_superadmin_audit_new_manager',
    { unique: false, columns: ['new_relationship_manager_id'] },
  ],
  [
    'idx_superadmin_audit_created_user',
    { unique: false, columns: ['created_user_id'] },
  ],
]);

const SUPERADMIN_AUDIT_FOREIGN_KEYS = new Map([
  [
    'fk_superadmin_audit_actor',
    {
      columns: ['superadmin_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      deleteRule: 'SET NULL',
      updateRule: 'NO ACTION',
    },
  ],
  [
    'fk_superadmin_audit_created_user',
    {
      columns: ['created_user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      deleteRule: 'SET NULL',
      updateRule: 'NO ACTION',
    },
  ],
  [
    'fk_superadmin_audit_new_manager',
    {
      columns: ['new_relationship_manager_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      deleteRule: 'SET NULL',
      updateRule: 'NO ACTION',
    },
  ],
  [
    'fk_superadmin_audit_portfolio',
    {
      columns: ['portfolio_id'],
      referencedTable: 'portfolios',
      referencedColumns: ['id'],
      deleteRule: 'SET NULL',
      updateRule: 'NO ACTION',
    },
  ],
  [
    'fk_superadmin_audit_previous_manager',
    {
      columns: ['previous_relationship_manager_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      deleteRule: 'SET NULL',
      updateRule: 'NO ACTION',
    },
  ],
]);

const PROTECTED_TABLES = [
  'users',
  'portfolios',
  'portfolio_documents',
  'investor_interests',
  'conversations',
  'conversation_members',
  'messages',
  'notifications',
  'audit_logs',
  'superadmin_audit_logs',
];

const CREATE_SUPERADMIN_AUDIT_LOGS = `
  CREATE TABLE superadmin_audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    superadmin_id INT DEFAULT NULL,
    superadmin_id_snapshot INT NOT NULL,
    superadmin_name_snapshot VARCHAR(100) NOT NULL,
    superadmin_email_snapshot VARCHAR(255) NOT NULL,
    action ENUM(
      'portfolio_assigned',
      'portfolio_reassigned',
      'portfolio_unassigned',
      'admin_account_created',
      'relationship_manager_account_created'
    ) NOT NULL,
    portfolio_id INT DEFAULT NULL,
    portfolio_id_snapshot INT DEFAULT NULL,
    portfolio_name_snapshot VARCHAR(255) DEFAULT NULL,
    previous_relationship_manager_id INT DEFAULT NULL,
    previous_relationship_manager_id_snapshot INT DEFAULT NULL,
    previous_relationship_manager_name_snapshot VARCHAR(100) DEFAULT NULL,
    previous_relationship_manager_email_snapshot VARCHAR(255) DEFAULT NULL,
    new_relationship_manager_id INT DEFAULT NULL,
    new_relationship_manager_id_snapshot INT DEFAULT NULL,
    new_relationship_manager_name_snapshot VARCHAR(100) DEFAULT NULL,
    new_relationship_manager_email_snapshot VARCHAR(255) DEFAULT NULL,
    created_user_id INT DEFAULT NULL,
    created_user_id_snapshot INT DEFAULT NULL,
    created_user_name_snapshot VARCHAR(100) DEFAULT NULL,
    created_user_email_snapshot VARCHAR(255) DEFAULT NULL,
    created_user_role ENUM('admin','relationship_manager') DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_superadmin_audit_actor (superadmin_id, created_at),
    KEY idx_superadmin_audit_action (action, created_at),
    KEY idx_superadmin_audit_portfolio (portfolio_id, created_at),
    KEY idx_superadmin_audit_previous_manager (previous_relationship_manager_id),
    KEY idx_superadmin_audit_new_manager (new_relationship_manager_id),
    KEY idx_superadmin_audit_created_user (created_user_id),
    CONSTRAINT fk_superadmin_audit_actor
      FOREIGN KEY (superadmin_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_superadmin_audit_created_user
      FOREIGN KEY (created_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_superadmin_audit_new_manager
      FOREIGN KEY (new_relationship_manager_id) REFERENCES users(id)
      ON DELETE SET NULL,
    CONSTRAINT fk_superadmin_audit_portfolio
      FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE SET NULL,
    CONSTRAINT fk_superadmin_audit_previous_manager
      FOREIGN KEY (previous_relationship_manager_id) REFERENCES users(id)
      ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`;

class FiveRoleMigrationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FiveRoleMigrationError';
    this.code = code;
  }
}

function assertMigrationGuards(environment) {
  if (
    environment.WORKFLOW_BACKUP_VERIFIED
    !== BACKUP_CONFIRMATION
  ) {
    throw new FiveRoleMigrationError(
      'A verified database backup is required',
      'BACKUP_NOT_VERIFIED',
    );
  }
  if (
    environment.CONFIRM_FIVE_ROLE_WORKFLOW_MIGRATION
    !== MIGRATION_CONFIRMATION
  ) {
    throw new FiveRoleMigrationError(
      'Five-role migration confirmation is required',
      'CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

async function rows(connection, sql, params = []) {
  const [result] = await connection.query(sql, params);
  return result;
}

async function count(connection, sql, params = []) {
  const result = await rows(connection, sql, params);
  return Number(result[0]?.count || 0);
}

function property(row, lowerName) {
  if (
    row
    && Object.prototype.hasOwnProperty.call(row, lowerName)
  ) {
    return row[lowerName];
  }
  return row?.[lowerName.toUpperCase()];
}

function normalizedSql(value) {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function normalizedExpression(value) {
  let normalized = String(value ?? '')
    .replace(/\\'/g, "'")
    .replace(/`/g, '')
    .replace(/_utf8mb4/gi, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  while (outerParenthesesEnclose(normalized)) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

function outerParenthesesEnclose(value) {
  if (!value.startsWith('(') || !value.endsWith(')')) return false;
  let depth = 0;
  let inString = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (inString && value[index + 1] === "'") {
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (inString) continue;
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function exactDefault(row, expected) {
  const actual = property(row, 'column_default');
  return actual === expected
    || (
      expected !== null
      && String(actual).toLowerCase() === String(expected).toLowerCase()
    );
}

function exactColumn(
  row,
  {
    type,
    nullable,
    defaultValue,
    ordinalPosition,
    extra,
  },
) {
  if (!row) return false;
  return (
    normalizedSql(property(row, 'column_type')) === normalizedSql(type)
    && String(property(row, 'is_nullable')).toUpperCase() === nullable
    && exactDefault(row, defaultValue)
    && (
      ordinalPosition === undefined
      || Number(property(row, 'ordinal_position')) === ordinalPosition
    )
    && (
      extra === undefined
      || normalizedSql(property(row, 'extra')) === normalizedSql(extra)
    )
  );
}

function singletonExpressionKind(row) {
  if (!exactColumn(row, {
    type: 'varchar(24)',
    nullable: 'YES',
    defaultValue: null,
    ordinalPosition: 4,
  })) {
    return 'invalid';
  }
  const extra = normalizedSql(property(row, 'extra'));
  if (extra !== 'storedgenerated' && extra !== 'generatedstored') {
    return 'invalid';
  }
  const expression = normalizedExpression(
    property(row, 'generation_expression'),
  );
  if (
    expression
    === normalizedExpression(PRIOR_SINGLETON_GENERATION_EXPRESSION)
  ) {
    return 'prior';
  }
  if (
    expression
    === normalizedExpression(FINAL_SINGLETON_GENERATION_EXPRESSION)
  ) {
    return 'final';
  }
  return 'invalid';
}

function exactIndex(indexRows, { unique, columns }) {
  if (indexRows.length !== columns.length) return false;
  const ordered = [...indexRows].sort((left, right) => (
    Number(property(left, 'seq_in_index'))
    - Number(property(right, 'seq_in_index'))
  ));
  return ordered.every((row, index) => (
    Number(property(row, 'non_unique')) === (unique ? 0 : 1)
    && String(property(row, 'index_type')).toUpperCase() === 'BTREE'
    && String(property(row, 'is_visible')).toUpperCase() === 'YES'
    && property(row, 'column_name') === columns[index]
  ));
}

function exactForeignKey(
  foreignKeyRows,
  {
    columns,
    referencedTable,
    referencedColumns,
    deleteRule,
    updateRule,
  },
) {
  if (foreignKeyRows.length !== columns.length) return false;
  const ordered = [...foreignKeyRows].sort((left, right) => (
    Number(property(left, 'ordinal_position'))
    - Number(property(right, 'ordinal_position'))
  ));
  return ordered.every((row, index) => (
    property(row, 'column_name') === columns[index]
    && property(row, 'referenced_table_name') === referencedTable
    && property(row, 'referenced_column_name') === referencedColumns[index]
    && String(property(row, 'delete_rule')).toUpperCase() === deleteRule
    && String(property(row, 'update_rule')).toUpperCase() === updateRule
  ));
}

function rowsForTable(metadata, collection, tableName) {
  return metadata[collection].filter((row) => (
    property(row, 'table_name') === tableName
  ));
}

function groupedBy(rowsToGroup, propertyName) {
  const groups = new Map();
  for (const row of rowsToGroup) {
    const name = property(row, propertyName);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return groups;
}

function superadminAuditMetadataKind(metadata) {
  const tableName = 'superadmin_audit_logs';
  const tables = rowsForTable(metadata, 'tables', tableName);
  const columns = rowsForTable(metadata, 'columns', tableName);
  const indexes = rowsForTable(metadata, 'indexes', tableName);
  const foreignKeys = rowsForTable(metadata, 'foreignKeys', tableName);
  if (tables.length === 0) {
    return (
      columns.length === 0
      && indexes.length === 0
      && foreignKeys.length === 0
    ) ? 'absent' : 'drifted';
  }
  if (
    tables.length !== 1
    || String(property(tables[0], 'table_type')).toUpperCase() !== 'BASE TABLE'
    || String(property(tables[0], 'engine')).toLowerCase() !== 'innodb'
    || String(property(tables[0], 'table_collation')).toLowerCase()
      !== 'utf8mb4_0900_ai_ci'
  ) {
    return 'drifted';
  }

  const expectedColumns = EXPECTED_SCHEMA.columns[tableName];
  if (columns.length !== expectedColumns.length) return 'drifted';
  for (const expected of expectedColumns) {
    const actual = columns.find((row) => (
      property(row, 'column_name') === expected.name
    ));
    if (!exactColumn(actual, {
      type: expected.type,
      nullable: expected.nullable,
      defaultValue: expected.defaultValue,
      ordinalPosition: expected.ordinalPosition,
      extra: expected.extra,
    })) {
      return 'drifted';
    }
    if (
      normalizedExpression(property(actual, 'generation_expression'))
      !== normalizedExpression(expected.generationExpression)
    ) {
      return 'drifted';
    }
  }

  const indexGroups = groupedBy(indexes, 'index_name');
  if (indexGroups.size !== SUPERADMIN_AUDIT_INDEXES.size) return 'drifted';
  for (const [name, contract] of SUPERADMIN_AUDIT_INDEXES) {
    if (!exactIndex(indexGroups.get(name) || [], contract)) return 'drifted';
  }

  const foreignKeyGroups = groupedBy(foreignKeys, 'constraint_name');
  if (
    foreignKeyGroups.size !== SUPERADMIN_AUDIT_FOREIGN_KEYS.size
  ) {
    return 'drifted';
  }
  for (const [name, contract] of SUPERADMIN_AUDIT_FOREIGN_KEYS) {
    if (
      !exactForeignKey(foreignKeyGroups.get(name) || [], contract)
    ) {
      return 'drifted';
    }
  }
  return 'final';
}

async function collectMigrationMetadata(connection) {
  const [tableRows, columnRows, indexRows, foreignKeyRows] = await Promise.all([
    rows(
      connection,
      `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type,
              ENGINE AS engine, TABLE_COLLATION AS table_collation
         FROM information_schema.tables
        WHERE table_schema = DATABASE()`,
    ),
    rows(
      connection,
      `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
              ORDINAL_POSITION AS ordinal_position, COLUMN_TYPE AS column_type,
              IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
              EXTRA AS extra, GENERATION_EXPRESSION AS generation_expression
         FROM information_schema.columns
        WHERE table_schema = DATABASE()`,
    ),
    rows(
      connection,
      `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
              NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq_in_index,
              COLUMN_NAME AS column_name, INDEX_TYPE AS index_type,
              IS_VISIBLE AS is_visible
         FROM information_schema.statistics
        WHERE table_schema = DATABASE()`,
    ),
    rows(
      connection,
      `SELECT k.TABLE_NAME AS table_name,
              k.CONSTRAINT_NAME AS constraint_name,
              k.COLUMN_NAME AS column_name,
              k.REFERENCED_TABLE_NAME AS referenced_table_name,
              k.REFERENCED_COLUMN_NAME AS referenced_column_name,
              k.ORDINAL_POSITION AS ordinal_position,
              r.UPDATE_RULE AS update_rule,
              r.DELETE_RULE AS delete_rule
         FROM information_schema.key_column_usage k
         JOIN information_schema.referential_constraints r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
          AND r.TABLE_NAME = k.TABLE_NAME
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = DATABASE()
          AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
    ),
  ]);
  return {
    tables: tableRows,
    columns: columnRows,
    indexes: indexRows,
    foreignKeys: foreignKeyRows,
  };
}

function metadataConnection(metadata) {
  return {
    async query(sql) {
      const source = String(sql);
      if (/information_schema\.tables/i.test(source)) {
        return [metadata.tables, []];
      }
      if (/information_schema\.columns/i.test(source)) {
        return [metadata.columns, []];
      }
      if (/information_schema\.statistics/i.test(source)) {
        return [metadata.indexes, []];
      }
      if (/information_schema\.key_column_usage/i.test(source)) {
        return [metadata.foreignKeys, []];
      }
      throw new Error(`Unexpected preserved-core metadata query: ${source}`);
    },
  };
}

function cloneMetadata(metadata) {
  return JSON.parse(JSON.stringify(metadata));
}

async function verifyMigrationInput(connection) {
  const metadata = await collectMigrationMetadata(connection);
  const role = metadata.columns.find((row) => (
    property(row, 'table_name') === 'users'
    && property(row, 'column_name') === 'role'
  ));
  const notificationType = metadata.columns.find((row) => (
    property(row, 'table_name') === 'notifications'
    && property(row, 'column_name') === 'type'
  ));
  const roleType = normalizedSql(property(role, 'column_type'));
  const notificationColumnType = normalizedSql(
    property(notificationType, 'column_type'),
  );
  if (
    ![
      normalizedSql(PRIOR_ROLE_COLUMN_TYPE),
      normalizedSql(FINAL_ROLE_COLUMN_TYPE),
    ].includes(roleType)
  ) {
    throw new FiveRoleMigrationError(
      'users.role is not a supported four-role or five-role migration input',
      'CORE_SCHEMA_INVALID',
    );
  }
  const singletonRole = metadata.columns.find((row) => (
    property(row, 'table_name') === 'conversation_members'
    && property(row, 'column_name') === 'singleton_role'
  ));
  if (singletonExpressionKind(singletonRole) === 'invalid') {
    throw new FiveRoleMigrationError(
      'conversation_members.singleton_role is not the known prior or final expression',
      'SINGLETON_EXPRESSION_INVALID',
    );
  }
  if (superadminAuditMetadataKind(metadata) === 'drifted') {
    throw new FiveRoleMigrationError(
      'Existing superadmin_audit_logs metadata differs from the final contract',
      'SUPERADMIN_AUDIT_SCHEMA_DRIFT',
    );
  }
  if (
    ![
      normalizedSql(PRIOR_NOTIFICATION_COLUMN_TYPE),
      normalizedSql(FINAL_NOTIFICATION_COLUMN_TYPE),
    ].includes(notificationColumnType)
  ) {
    throw new FiveRoleMigrationError(
      'notifications.type is not a supported migration input',
      'CORE_SCHEMA_INVALID',
    );
  }

  const normalized = cloneMetadata(metadata);
  const normalizedRole = normalized.columns.find((row) => (
    property(row, 'table_name') === 'users'
    && property(row, 'column_name') === 'role'
  ));
  const normalizedNotificationType = normalized.columns.find((row) => (
    property(row, 'table_name') === 'notifications'
    && property(row, 'column_name') === 'type'
  ));
  normalizedRole.column_type = PRIOR_ROLE_COLUMN_TYPE;
  normalizedNotificationType.column_type = PRIOR_NOTIFICATION_COLUMN_TYPE;
  try {
    await verifyPreservedCoreSchema(metadataConnection(normalized));
  } catch (error) {
    throw new FiveRoleMigrationError(
      `Preserved core schema validation failed: ${error.message}`,
      'CORE_SCHEMA_INVALID',
    );
  }
  return metadata;
}

async function readProtectedState(connection, existingTableNames) {
  const counts = {};
  for (const tableName of PROTECTED_TABLES) {
    counts[tableName] = (
      existingTableNames && !existingTableNames.has(tableName)
        ? 0
        : await count(
          connection,
          `SELECT COUNT(*) AS count FROM \`${tableName}\``,
        )
    );
  }
  const messages = await rows(
    connection,
    'SELECT id, conversation_id, sender_id FROM messages ORDER BY id',
  );
  const members = await rows(
    connection,
    `SELECT conversation_id, user_id
       FROM conversation_members
      ORDER BY conversation_id, user_id`,
  );
  return { counts, messages, members };
}

async function assertNoPortfolioConversationManagerConflicts(connection) {
  const assignmentColumns = await readColumn(
    connection,
    'portfolios',
    'relationship_manager_id',
  );
  if (!assignmentColumns.length) return;
  const conflicts = await rows(
    connection,
    `SELECT p.id AS portfolio_id,
            p.relationship_manager_id AS portfolio_manager_id,
            c.relationship_manager_id AS conversation_manager_id
       FROM portfolios p
       JOIN conversations c ON c.portfolio_id = p.id
      WHERE p.relationship_manager_id IS NOT NULL
        AND p.relationship_manager_id <> c.relationship_manager_id`,
  );
  if (conflicts.length) {
    throw new FiveRoleMigrationError(
      `Portfolio and conversation manager assignments conflict: ${
        conflicts.map((row) => property(row, 'portfolio_id')).join(', ')
      }`,
      'ASSIGNMENT_CONFLICT',
    );
  }
}

async function assertAssignedUsersAreRelationshipManagers(connection) {
  const assignmentColumns = await readColumn(
    connection,
    'portfolios',
    'relationship_manager_id',
  );
  const invalid = assignmentColumns.length
    ? await rows(
      connection,
      `SELECT p.id AS portfolio_id,
              COALESCE(
                p.relationship_manager_id,
                c.relationship_manager_id
              ) AS relationship_manager_id,
              u.id AS assigned_user_id,
              u.role AS assigned_user_role
         FROM portfolios p
         LEFT JOIN conversations c ON c.portfolio_id = p.id
         LEFT JOIN users u
           ON u.id = COALESCE(
             p.relationship_manager_id,
             c.relationship_manager_id
           )
        WHERE COALESCE(
                p.relationship_manager_id,
                c.relationship_manager_id
              ) IS NOT NULL
          AND (
            u.id IS NULL
            OR u.role <> 'relationship_manager'
          )`,
    )
    : await rows(
      connection,
      `SELECT p.id AS portfolio_id,
              c.relationship_manager_id AS relationship_manager_id,
              u.id AS assigned_user_id,
              u.role AS assigned_user_role
         FROM portfolios p
         JOIN conversations c ON c.portfolio_id = p.id
         LEFT JOIN users u ON u.id = c.relationship_manager_id
        WHERE u.id IS NULL
           OR u.role <> 'relationship_manager'`,
    );
  if (invalid.length) {
    throw new FiveRoleMigrationError(
      `Portfolio assignments include non-relationship-manager users: ${
        invalid.map((row) => property(row, 'portfolio_id')).join(', ')
      }`,
      'ASSIGNEE_ROLE_INVALID',
    );
  }
}

async function assertNoDuplicateActiveSingletons(connection) {
  const duplicates = await rows(
    connection,
    `SELECT conversation_id, member_role,
            COUNT(*) AS duplicate_count
       FROM conversation_members
      WHERE membership_status = 'active'
        AND member_role IN ('relationship_manager','business_owner')
      GROUP BY conversation_id, member_role
     HAVING COUNT(*) > 1`,
  );
  if (duplicates.length) {
    throw new FiveRoleMigrationError(
      'Duplicate active relationship-manager or business-owner members exist',
      'DUPLICATE_ACTIVE_SINGLETON',
    );
  }
}

async function readColumn(connection, tableName, columnName) {
  return rows(
    connection,
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            ORDINAL_POSITION AS ordinal_position, COLUMN_TYPE AS column_type,
            IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
            EXTRA AS extra, GENERATION_EXPRESSION AS generation_expression
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?`,
    [tableName, columnName],
  );
}

async function readIndex(connection, tableName, indexName) {
  return rows(
    connection,
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
            NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq_in_index,
            COLUMN_NAME AS column_name, INDEX_TYPE AS index_type,
            IS_VISIBLE AS is_visible
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?`,
    [tableName, indexName],
  );
}

async function readForeignKey(connection, tableName, constraintName) {
  return rows(
    connection,
    `SELECT k.TABLE_NAME AS table_name,
            k.CONSTRAINT_NAME AS constraint_name,
            k.COLUMN_NAME AS column_name,
            k.REFERENCED_TABLE_NAME AS referenced_table_name,
            k.REFERENCED_COLUMN_NAME AS referenced_column_name,
            k.ORDINAL_POSITION AS ordinal_position,
            r.UPDATE_RULE AS update_rule,
            r.DELETE_RULE AS delete_rule
       FROM information_schema.key_column_usage k
       JOIN information_schema.referential_constraints r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.TABLE_NAME = k.TABLE_NAME
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = DATABASE()
        AND k.TABLE_NAME = ?
        AND k.CONSTRAINT_NAME = ?`,
    [tableName, constraintName],
  );
}

async function ensureFiveRoleEnum(connection, changed) {
  const [role] = await readColumn(connection, 'users', 'role');
  if (exactColumn(role, {
    type: FINAL_ROLE_COLUMN_TYPE,
    nullable: 'NO',
    defaultValue: null,
    ordinalPosition: 5,
  })) {
    return;
  }
  await connection.query(
    `ALTER TABLE users
       MODIFY COLUMN role ENUM(
         'business_owner',
         'investor',
         'relationship_manager',
         'admin',
         'superadmin'
       ) NOT NULL`,
  );
  changed.push('users.role');
}

async function ensurePortfolioAssignmentColumnIndexAndForeignKey(
  connection,
  changed,
) {
  const [columns, indexes, foreignKeys] = await Promise.all([
    readColumn(connection, 'portfolios', 'relationship_manager_id'),
    readIndex(connection, 'portfolios', 'fk_relationship_manager'),
    readForeignKey(connection, 'portfolios', 'fk_relationship_manager'),
  ]);
  if (
    indexes.length
    && !exactIndex(indexes, {
      unique: false,
      columns: ['relationship_manager_id'],
    })
  ) {
    throw new FiveRoleMigrationError(
      'The existing portfolio manager index conflicts with the final contract',
      'SCHEMA_OBJECT_CONFLICT',
    );
  }
  if (
    foreignKeys.length
    && !exactForeignKey(foreignKeys, {
      columns: ['relationship_manager_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      deleteRule: 'SET NULL',
      updateRule: 'NO ACTION',
    })
  ) {
    throw new FiveRoleMigrationError(
      'The existing portfolio manager foreign key conflicts with the final contract',
      'SCHEMA_OBJECT_CONFLICT',
    );
  }

  const [assignmentColumn] = columns;
  if (!assignmentColumn) {
    await connection.query(
      `ALTER TABLE portfolios
         ADD COLUMN relationship_manager_id INT NULL AFTER runway_months`,
    );
    changed.push('portfolios.relationship_manager_id');
  } else if (!exactColumn(assignmentColumn, {
    type: 'int',
    nullable: 'YES',
    defaultValue: null,
    ordinalPosition: 26,
    extra: '',
  })) {
    await connection.query(
      `ALTER TABLE portfolios
         MODIFY COLUMN relationship_manager_id INT NULL AFTER runway_months`,
    );
    changed.push('portfolios.relationship_manager_id');
  }

  if (!indexes.length) {
    await connection.query(
      `ALTER TABLE portfolios
         ADD KEY fk_relationship_manager (relationship_manager_id)`,
    );
    changed.push('portfolios.fk_relationship_manager.index');
  }
  if (!foreignKeys.length) {
    await connection.query(
      `ALTER TABLE portfolios
         ADD CONSTRAINT fk_relationship_manager
         FOREIGN KEY (relationship_manager_id) REFERENCES users(id)
         ON DELETE SET NULL`,
    );
    changed.push('portfolios.fk_relationship_manager.foreign_key');
  }
}

async function backfillNullAssignmentsFromConversationManagers(
  connection,
  result,
) {
  const expected = await count(
    connection,
    `SELECT COUNT(*) AS count
       FROM portfolios p
       JOIN conversations c ON c.portfolio_id = p.id
      WHERE p.relationship_manager_id IS NULL`,
  );
  if (expected === 0) return;
  const [updateResult] = await connection.query(
    `UPDATE portfolios p
       JOIN conversations c ON c.portfolio_id = p.id
       SET p.relationship_manager_id = c.relationship_manager_id
     WHERE p.relationship_manager_id IS NULL`,
  );
  const affected = Number(updateResult?.affectedRows);
  if (!Number.isInteger(affected) || affected !== expected) {
    throw new FiveRoleMigrationError(
      `Portfolio assignment backfill mismatch: expected ${expected}, affected ${
        Number.isFinite(affected) ? affected : 'unknown'
      }`,
      'BACKFILL_COUNT_MISMATCH',
    );
  }
  result.backfilled_assignments = affected;
}

async function ensureActiveOnlySingletonExpression(connection, changed) {
  const [columns, indexes] = await Promise.all([
    readColumn(connection, 'conversation_members', 'singleton_role'),
    readIndex(
      connection,
      'conversation_members',
      'unique_conversation_singleton',
    ),
  ]);
  if (
    indexes.length
    && !exactIndex(indexes, {
      unique: true,
      columns: ['conversation_id', 'singleton_role'],
    })
  ) {
    throw new FiveRoleMigrationError(
      'The existing conversation singleton index conflicts with the final contract',
      'SCHEMA_OBJECT_CONFLICT',
    );
  }
  const expressionKind = singletonExpressionKind(columns[0]);
  if (expressionKind === 'invalid') {
    throw new FiveRoleMigrationError(
      'conversation_members.singleton_role changed after preflight',
      'SINGLETON_EXPRESSION_INVALID',
    );
  }
  if (expressionKind === 'prior') {
    await connection.query(
      `ALTER TABLE conversation_members
         MODIFY COLUMN singleton_role VARCHAR(24)
         GENERATED ALWAYS AS (
           CASE
             WHEN membership_status = 'active'
              AND member_role IN ('relationship_manager','business_owner')
             THEN member_role
             ELSE NULL
           END
         ) STORED`,
    );
    changed.push('conversation_members.singleton_role');
  }
  if (!indexes.length) {
    await connection.query(
      `ALTER TABLE conversation_members
         ADD UNIQUE KEY unique_conversation_singleton
         (conversation_id, singleton_role)`,
    );
    changed.push('conversation_members.unique_conversation_singleton');
  }
}

async function ensureFinalNotificationEnum(connection, changed) {
  const [notificationType] = await readColumn(
    connection,
    'notifications',
    'type',
  );
  if (exactColumn(notificationType, {
    type: FINAL_NOTIFICATION_COLUMN_TYPE,
    nullable: 'NO',
    defaultValue: null,
    ordinalPosition: 3,
  })) {
    return;
  }
  await connection.query(
    `ALTER TABLE notifications
       MODIFY COLUMN type ENUM(
         'new_message',
         'new_interest',
         'portfolio_approved',
         'portfolio_rejected',
         'portfolio_needs_changes',
         'portfolio_submitted',
         'conversation_created',
         'conversation_member_added',
         'conversation_archived',
         'portfolio_assigned',
         'portfolio_reassigned',
         'portfolio_unassigned',
         'conversation_member_removed'
       ) NOT NULL`,
  );
  changed.push('notifications.type');
}

async function ensureSuperadminAuditTable(connection, changed) {
  const existing = await rows(
    connection,
    `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type,
            ENGINE AS engine, TABLE_COLLATION AS table_collation
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    ['superadmin_audit_logs'],
  );
  if (existing.length) return;
  await connection.query(CREATE_SUPERADMIN_AUDIT_LOGS);
  changed.push('superadmin_audit_logs');
}

async function verifyFinalSchema(connection) {
  try {
    await verifySchema(connection);
  } catch (error) {
    throw new FiveRoleMigrationError(
      `Final schema verification failed: ${error.message}`,
      'FINAL_SCHEMA_INVALID',
    );
  }
}

function identicalRows(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verifyProtectedRowsAndIdentities(before, after) {
  const changedCounts = PROTECTED_TABLES.filter(
    (tableName) => before.counts[tableName] !== after.counts[tableName],
  );
  if (changedCounts.length) {
    throw new FiveRoleMigrationError(
      `Protected row counts changed: ${
        changedCounts.map((tableName) => (
          `${tableName}: ${before.counts[tableName]} -> ${
            after.counts[tableName]
          }`
        )).join(', ')
      }`,
      'PROTECTED_ROWS_CHANGED',
    );
  }
  if (
    !identicalRows(before.messages, after.messages)
    || !identicalRows(before.members, after.members)
  ) {
    throw new FiveRoleMigrationError(
      'Protected message or conversation-member identities changed',
      'PROTECTED_IDENTITIES_CHANGED',
    );
  }
}

async function migrateFiveRoleWorkflow(
  connection,
  environment = process.env,
) {
  assertMigrationGuards(environment);
  let lockAcquired = false;
  try {
    const lockRows = await rows(
      connection,
      'SELECT GET_LOCK(?, 30) AS acquired',
      [MIGRATION_LOCK],
    );
    if (Number(property(lockRows[0], 'acquired')) !== 1) {
      throw new FiveRoleMigrationError(
        'Could not acquire the five-role workflow migration lock',
        'LOCK_NOT_ACQUIRED',
      );
    }
    lockAcquired = true;

    const migrationMetadata = await verifyMigrationInput(connection);
    const existingTableNames = new Set(
      migrationMetadata.tables.map((row) => property(row, 'table_name')),
    );
    const before = await readProtectedState(connection, existingTableNames);
    const result = {
      changed: [],
      backfilled_assignments: 0,
      before: before.counts,
      after: {},
    };

    await assertNoPortfolioConversationManagerConflicts(connection);
    await assertAssignedUsersAreRelationshipManagers(connection);
    await assertNoDuplicateActiveSingletons(connection);

    await ensureFiveRoleEnum(connection, result.changed);
    await ensurePortfolioAssignmentColumnIndexAndForeignKey(
      connection,
      result.changed,
    );
    await backfillNullAssignmentsFromConversationManagers(connection, result);
    await ensureActiveOnlySingletonExpression(connection, result.changed);
    await ensureFinalNotificationEnum(connection, result.changed);
    await ensureSuperadminAuditTable(connection, result.changed);
    await verifyFinalSchema(connection);

    const after = await readProtectedState(connection);
    result.after = after.counts;
    verifyProtectedRowsAndIdentities(before, after);
    return result;
  } finally {
    if (lockAcquired) {
      await connection.query(
        'SELECT RELEASE_LOCK(?) AS released',
        [MIGRATION_LOCK],
      );
    }
  }
}

module.exports = {
  BACKUP_CONFIRMATION,
  MIGRATION_CONFIRMATION,
  FiveRoleMigrationError,
  assertMigrationGuards,
  migrateFiveRoleWorkflow,
};

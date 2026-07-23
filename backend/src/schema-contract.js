function defineColumns(rows) {
  return rows.map(([
    name,
    type,
    nullable,
    defaultValue,
    extra = '',
    generationExpression = '',
  ], index) => ({
    name,
    type,
    nullable,
    defaultValue,
    extra,
    generationExpression,
    ordinalPosition: index + 1,
  }));
}

const COLUMN_CONTRACT = {
  users: defineColumns([
    ['id', 'int', 'NO', null, 'auto_increment'],
    ['email', 'varchar(255)', 'NO', null],
    ['password_hash', 'varchar(255)', 'NO', null],
    ['name', 'varchar(100)', 'NO', null],
    [
      'role',
      "enum('business_owner','investor','relationship_manager','admin')",
      'NO',
      'business_owner',
    ],
    ['created_at', 'timestamp', 'YES', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
    [
      'updated_at',
      'timestamp',
      'YES',
      'CURRENT_TIMESTAMP',
      'DEFAULT_GENERATED on update CURRENT_TIMESTAMP',
    ],
  ]),
  portfolios: defineColumns([
    ['id', 'int', 'NO', null, 'auto_increment'],
    ['owner_id', 'int', 'NO', null],
    ['name', 'varchar(255)', 'NO', null],
    ['sector', 'varchar(100)', 'NO', null],
    ['description', 'text', 'YES', null],
    ['mvp_status', "enum('Idea','Prototype','Beta','Launched')", 'NO', null],
    ['funding_goal', 'decimal(15,2)', 'NO', null],
    ['team_size', 'int', 'YES', null],
    ['founded_year', 'year', 'YES', null],
    ['location', 'varchar(255)', 'YES', null],
    ['website', 'varchar(500)', 'YES', null],
    ['readiness_score', 'int', 'YES', '0'],
    [
      'status',
      "enum('draft','pending','approved','rejected')",
      'NO',
      'draft',
    ],
    ['rejection_reason', 'text', 'YES', null],
    ['submitted_at', 'timestamp', 'YES', null],
    ['created_at', 'timestamp', 'YES', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
    [
      'updated_at',
      'timestamp',
      'YES',
      'CURRENT_TIMESTAMP',
      'DEFAULT_GENERATED on update CURRENT_TIMESTAMP',
    ],
    ['monthly_revenue', 'decimal(15,2)', 'YES', null],
    ['user_count', 'int', 'YES', null],
    ['growth_rate', 'decimal(5,2)', 'YES', null],
    ['market_size', 'varchar(500)', 'YES', null],
    ['competitor_analysis', 'text', 'YES', null],
    ['advisor_names', 'varchar(500)', 'YES', null],
    ['burn_rate', 'decimal(15,2)', 'YES', null],
    ['runway_months', 'int', 'YES', null],
  ]),
  portfolio_documents: defineColumns([
    ['id', 'int', 'NO', null, 'auto_increment'],
    ['portfolio_id', 'int', 'NO', null],
    ['file_name', 'varchar(255)', 'NO', null],
    ['file_url', 'varchar(500)', 'NO', null],
    ['file_type', 'varchar(50)', 'YES', null],
    ['uploaded_at', 'timestamp', 'YES', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
  ]),
  investor_interests: defineColumns([
    ['id', 'int', 'NO', null, 'auto_increment'],
    ['investor_id', 'int', 'NO', null],
    ['portfolio_id', 'int', 'NO', null],
    ['created_at', 'timestamp', 'YES', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
  ]),
  conversations: defineColumns([
    ['id', 'int', 'NO', null, 'auto_increment'],
    ['portfolio_id', 'int', 'YES', null],
    ['relationship_manager_id', 'int', 'NO', null],
    ['title', 'varchar(255)', 'NO', null],
    ['status', "enum('active','archived')", 'NO', 'active'],
    [
      'archived_reason',
      "enum('manual','no_active_investors','portfolio_unapproved','portfolio_deleted')",
      'YES',
      null,
    ],
    ['created_at', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
    [
      'updated_at',
      'timestamp',
      'NO',
      'CURRENT_TIMESTAMP',
      'DEFAULT_GENERATED on update CURRENT_TIMESTAMP',
    ],
  ]),
  conversation_members: defineColumns([
    ['conversation_id', 'int', 'NO', null],
    ['user_id', 'int', 'NO', null],
    [
      'member_role',
      "enum('relationship_manager','business_owner','investor')",
      'NO',
      null,
    ],
    [
      'singleton_role',
      'varchar(24)',
      'YES',
      null,
      'STORED GENERATED',
      "(case when (`member_role` in (_utf8mb4'relationship_manager',_utf8mb4'business_owner')) then `member_role` else NULL end)",
    ],
    ['membership_status', "enum('active','removed')", 'NO', 'active'],
    ['joined_at', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
    ['left_at', 'timestamp', 'YES', null],
    ['visible_after_message_id', 'bigint unsigned', 'NO', '0'],
    ['last_read_message_id', 'bigint unsigned', 'NO', '0'],
  ]),
  messages: defineColumns([
    ['id', 'int', 'NO', null, 'auto_increment'],
    ['conversation_id', 'int', 'NO', null],
    ['sender_id', 'int', 'NO', null],
    ['content', 'text', 'NO', null],
    ['created_at', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
  ]),
  notifications: defineColumns([
    ['id', 'int', 'NO', null, 'auto_increment'],
    ['user_id', 'int', 'NO', null],
    [
      'type',
      "enum('new_message','new_interest','portfolio_approved','portfolio_rejected','portfolio_needs_changes','portfolio_submitted','conversation_created','conversation_member_added','conversation_archived')",
      'NO',
      null,
    ],
    ['title', 'varchar(255)', 'NO', null],
    ['body', 'text', 'YES', null],
    ['related_portfolio_id', 'int', 'YES', null],
    ['related_conversation_id', 'int', 'YES', null],
    ['related_message_id', 'int', 'YES', null],
    ['related_user_id', 'int', 'YES', null],
    ['read_at', 'timestamp', 'YES', null],
    ['created_at', 'timestamp', 'YES', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
  ]),
  audit_logs: defineColumns([
    ['id', 'int', 'NO', null, 'auto_increment'],
    ['admin_id', 'int', 'NO', null],
    ['action', "enum('approved','rejected')", 'NO', null],
    ['portfolio_id', 'int', 'NO', null],
    ['reason', 'text', 'YES', null],
    ['created_at', 'timestamp', 'YES', 'CURRENT_TIMESTAMP', 'DEFAULT_GENERATED'],
  ]),
};

const PRIMARY_INDEX_CONTRACT = [
  ['users', ['id']],
  ['portfolios', ['id']],
  ['portfolio_documents', ['id']],
  ['investor_interests', ['id']],
  ['conversations', ['id']],
  ['conversation_members', ['conversation_id', 'user_id']],
  ['messages', ['id']],
  ['notifications', ['id']],
  ['audit_logs', ['id']],
];

const UNIQUE_INDEX_CONTRACT = [
  ['users', ['email']],
  ['investor_interests', ['investor_id', 'portfolio_id']],
  ['conversations', ['portfolio_id']],
  ['conversation_members', ['conversation_id', 'singleton_role']],
];

const ACCESS_INDEX_CONTRACT = [
  ['portfolios', ['owner_id']],
  ['portfolio_documents', ['portfolio_id']],
  ['investor_interests', ['portfolio_id']],
  ['conversations', ['relationship_manager_id']],
  ['conversation_members', ['user_id', 'membership_status']],
  ['messages', ['conversation_id', 'id']],
  ['messages', ['conversation_id', 'sender_id']],
  ['notifications', ['user_id']],
  ['notifications', ['related_portfolio_id']],
  ['notifications', ['related_conversation_id']],
  ['notifications', ['related_message_id']],
  ['notifications', ['related_user_id']],
  ['audit_logs', ['admin_id']],
  ['audit_logs', ['portfolio_id']],
];

const FOREIGN_KEY_CONTRACT = [
  ['portfolios', ['owner_id'], 'users', ['id'], 'CASCADE', 'NO ACTION'],
  [
    'portfolio_documents',
    ['portfolio_id'],
    'portfolios',
    ['id'],
    'CASCADE',
    'NO ACTION',
  ],
  [
    'investor_interests',
    ['investor_id'],
    'users',
    ['id'],
    'CASCADE',
    'NO ACTION',
  ],
  [
    'investor_interests',
    ['portfolio_id'],
    'portfolios',
    ['id'],
    'CASCADE',
    'NO ACTION',
  ],
  [
    'conversations',
    ['portfolio_id'],
    'portfolios',
    ['id'],
    'SET NULL',
    'NO ACTION',
  ],
  [
    'conversations',
    ['relationship_manager_id'],
    'users',
    ['id'],
    'RESTRICT',
    'NO ACTION',
  ],
  [
    'conversation_members',
    ['conversation_id'],
    'conversations',
    ['id'],
    'CASCADE',
    'NO ACTION',
  ],
  [
    'conversation_members',
    ['user_id'],
    'users',
    ['id'],
    'RESTRICT',
    'NO ACTION',
  ],
  [
    'messages',
    ['conversation_id', 'sender_id'],
    'conversation_members',
    ['conversation_id', 'user_id'],
    'RESTRICT',
    'NO ACTION',
  ],
  ['notifications', ['user_id'], 'users', ['id'], 'CASCADE', 'NO ACTION'],
  [
    'notifications',
    ['related_portfolio_id'],
    'portfolios',
    ['id'],
    'SET NULL',
    'NO ACTION',
  ],
  [
    'notifications',
    ['related_conversation_id'],
    'conversations',
    ['id'],
    'SET NULL',
    'NO ACTION',
  ],
  [
    'notifications',
    ['related_message_id'],
    'messages',
    ['id'],
    'SET NULL',
    'NO ACTION',
  ],
  [
    'notifications',
    ['related_user_id'],
    'users',
    ['id'],
    'SET NULL',
    'NO ACTION',
  ],
  ['audit_logs', ['admin_id'], 'users', ['id'], 'CASCADE', 'NO ACTION'],
  [
    'audit_logs',
    ['portfolio_id'],
    'portfolios',
    ['id'],
    'CASCADE',
    'NO ACTION',
  ],
];

const PRESERVED_CORE_TABLES = new Set([
  'users',
  'portfolios',
  'portfolio_documents',
  'investor_interests',
  'notifications',
  'audit_logs',
]);

const ALLOWED_MIGRATION_ROLE_TYPES = [
  "enum('business_owner','investor','admin')",
  "enum('business_owner','investor','relationship_manager','admin')",
];

const ALLOWED_MIGRATION_NOTIFICATION_TYPES = [
  "enum('new_message','new_interest','portfolio_approved','portfolio_rejected','portfolio_needs_changes','portfolio_submitted')",
  "enum('new_message','new_interest','portfolio_approved','portfolio_rejected','portfolio_needs_changes','portfolio_submitted','conversation_created','conversation_member_added','conversation_archived')",
];

function property(row, lower, upper = lower.toUpperCase()) {
  return row?.[lower] ?? row?.[upper];
}

function normalizeSqlText(value, { removeBackticks = false } = {}) {
  let result = '';
  let inString = false;
  const source = String(value ?? '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'") {
      result += character;
      if (inString && source[index + 1] === "'") {
        result += source[index + 1];
        index += 1;
      } else {
        inString = !inString;
      }
    } else if (inString) {
      result += character;
    } else if (removeBackticks && character === '`') {
      continue;
    } else if (!/\s/.test(character)) {
      result += character.toLowerCase();
    }
  }
  return result;
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

function normalizeGenerationExpression(value) {
  let normalized = normalizeSqlText(value, { removeBackticks: true });
  while (outerParenthesesEnclose(normalized)) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (/^current_timestamp(?:\(\))?$/i.test(normalized)) {
    return 'CURRENT_TIMESTAMP';
  }
  return normalized;
}

function extraSemantics(value) {
  let remainder = String(value ?? '').trim().toLowerCase();
  if (!remainder) return [];
  remainder = remainder.replace(/current_timestamp\(\)/g, 'current_timestamp');
  const semantics = [];
  const patterns = [
    ['on update CURRENT_TIMESTAMP', /\bon\s+update\s+current_timestamp\b/g],
    ['auto_increment', /\bauto_increment\b/g],
    ['DEFAULT_GENERATED', /\bdefault_generated\b/g],
  ];
  for (const [label, pattern] of patterns) {
    if (pattern.test(remainder)) semantics.push(label);
    remainder = remainder.replace(pattern, ' ');
  }
  const hasStored = /\bstored\b/.test(remainder);
  const hasGenerated = /\bgenerated\b/.test(remainder);
  if (hasStored && hasGenerated) semantics.push('STORED GENERATED');
  remainder = remainder
    .replace(/\bstored\b/g, ' ')
    .replace(/\bgenerated\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (remainder) semantics.push(`unexpected:${remainder}`);
  return semantics.sort();
}

function orderedGroups(rows, nameProperty) {
  const groups = new Map();
  for (const row of rows) {
    const table = property(row, 'table_name');
    const name = property(row, nameProperty);
    const key = `${table}.${name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => Number(
      property(left, 'seq_in_index')
        ?? property(left, 'ordinal_position'),
    ) - Number(
      property(right, 'seq_in_index')
        ?? property(right, 'ordinal_position'),
    ));
  }
  return groups;
}

function sameValues(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function indexColumns(rows) {
  return rows.map((row) => property(row, 'column_name'));
}

function usableIndex(rows, { unique }) {
  return rows.length > 0
    && rows.every((row) => (
      Number(property(row, 'non_unique')) === (unique ? 0 : 1)
      && String(property(row, 'index_type')).toUpperCase() === 'BTREE'
      && String(property(row, 'is_visible')).toUpperCase() === 'YES'
    ));
}

function indexIssue(table, kind, columns) {
  if (kind === 'PRIMARY') {
    return `${table} PRIMARY must be (${columns.join(',')})`;
  }
  return `${table} ${kind} index (${columns.join(',')}) is required`;
}

function foreignKeyIssue([
  table,
  columns,
  referencedTable,
  referencedColumns,
  deleteRule,
  updateRule,
]) {
  return `${table} foreign key (${columns.join(',')}) -> `
    + `${referencedTable}(${referencedColumns.join(',')}) must use `
    + `ON DELETE ${deleteRule} and ON UPDATE ${updateRule}`;
}

function columnIssueLabel(field, attribute, expected) {
  if (attribute === 'type') return `${field} type must be ${expected}`;
  if (attribute === 'nullable') return `${field} nullability must be ${expected}`;
  if (attribute === 'default') return `${field} default must be ${expected}`;
  if (attribute === 'ordinal') return `${field} ordinal position must be ${expected}`;
  if (attribute === 'generation') return `${field} generation expression changed`;
  return `${field} ${attribute} changed`;
}

async function collectSchemaMetadata(database) {
  const [tableRows] = await database.query(
    `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type,
            ENGINE AS engine, TABLE_COLLATION AS table_collation
       FROM information_schema.tables
      WHERE table_schema = DATABASE()`,
  );
  const [columnRows] = await database.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            ORDINAL_POSITION AS ordinal_position, COLUMN_TYPE AS column_type,
            IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
            EXTRA AS extra, GENERATION_EXPRESSION AS generation_expression
       FROM information_schema.columns
      WHERE table_schema = DATABASE()`,
  );
  const [indexRows] = await database.query(
    `SELECT TABLE_NAME AS table_name,
            INDEX_NAME AS index_name,
            NON_UNIQUE AS non_unique,
            SEQ_IN_INDEX AS seq_in_index,
            COLUMN_NAME AS column_name,
            INDEX_TYPE AS index_type,
            IS_VISIBLE AS is_visible
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()`,
  );
  const [foreignKeyRows] = await database.query(
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
  );
  return {
    tableRows,
    columnRows,
    indexRows,
    foreignKeyRows,
  };
}

function appendTableIssues(tableRows, requiredTables, issues) {
  const tables = new Map(tableRows.map((row) => [
    property(row, 'table_name'),
    row,
  ]));
  for (const tableName of requiredTables) {
    const actual = tables.get(tableName);
    if (!actual) {
      issues.push(`${tableName} table must exist`);
      continue;
    }
    if (String(property(actual, 'table_type')).toUpperCase() !== 'BASE TABLE') {
      issues.push(`${tableName} table type must be BASE TABLE`);
    }
    if (String(property(actual, 'engine')).toLowerCase() !== 'innodb') {
      issues.push(`${tableName} engine must be InnoDB`);
    }
    if (
      String(property(actual, 'table_collation')).toLowerCase()
      !== 'utf8mb4_0900_ai_ci'
    ) {
      issues.push(`${tableName} collation must be utf8mb4_0900_ai_ci`);
    }
  }
}

function appendColumnIssues(
  columnRows,
  contract,
  issues,
  {
    checkOrdinal = () => true,
    allowedTypes = new Map(),
  } = {},
) {
  const columns = new Map(columnRows.map((actual) => [
    `${property(actual, 'table_name')}.${property(actual, 'column_name')}`,
    actual,
  ]));
  for (const [tableName, definitions] of Object.entries(contract)) {
    for (const expected of definitions) {
      const field = `${tableName}.${expected.name}`;
      const actual = columns.get(field);
      if (!actual) {
        issues.push(`${field} must exist`);
        continue;
      }
      if (
        checkOrdinal(tableName, expected)
        && Number(property(actual, 'ordinal_position')) !== expected.ordinalPosition
      ) {
        issues.push(columnIssueLabel(
          field,
          'ordinal',
          expected.ordinalPosition,
        ));
      }

      const actualType = normalizeSqlText(property(actual, 'column_type'));
      const acceptedTypes = allowedTypes.get(field);
      if (acceptedTypes) {
        if (!acceptedTypes.some((type) => actualType === normalizeSqlText(type))) {
          issues.push(`${field} must use an allowed migration enum shape`);
        }
      } else if (actualType !== normalizeSqlText(expected.type)) {
        issues.push(columnIssueLabel(field, 'type', expected.type));
      }
      if (String(property(actual, 'is_nullable')).toUpperCase() !== expected.nullable) {
        issues.push(columnIssueLabel(field, 'nullable', expected.nullable));
      }
      if (
        normalizeDefault(property(actual, 'column_default'))
        !== normalizeDefault(expected.defaultValue)
      ) {
        issues.push(columnIssueLabel(
          field,
          'default',
          expected.defaultValue === null ? 'NULL' : expected.defaultValue,
        ));
      }

      const actualExtra = extraSemantics(property(actual, 'extra'));
      const expectedExtra = extraSemantics(expected.extra);
      if (!sameValues(actualExtra, expectedExtra)) {
        if (expectedExtra.includes('auto_increment')) {
          issues.push(`${field} extra must include auto_increment`);
        } else if (expectedExtra.includes('on update CURRENT_TIMESTAMP')) {
          issues.push(`${field} extra must include on update CURRENT_TIMESTAMP`);
        } else {
          issues.push(`${field} extra must be ${expected.extra || 'empty'}`);
        }
      }

      if (
        normalizeGenerationExpression(property(actual, 'generation_expression'))
        !== normalizeGenerationExpression(expected.generationExpression)
      ) {
        issues.push(columnIssueLabel(field, 'generation'));
      }
    }
  }
  return columns;
}

function appendIndexIssues(
  indexRows,
  issues,
  {
    primaryContract,
    uniqueContract,
    accessContract,
  },
) {
  const indexes = orderedGroups(indexRows, 'index_name');
  const indexGroups = [...indexes.values()];
  for (const [table, columnsInPrimary] of primaryContract) {
    const rows = indexes.get(`${table}.PRIMARY`) || [];
    if (
      !usableIndex(rows, { unique: true })
      || !sameValues(indexColumns(rows), columnsInPrimary)
    ) {
      issues.push(indexIssue(table, 'PRIMARY', columnsInPrimary));
    }
  }
  for (const [table, columnsInUnique] of uniqueContract) {
    const match = indexGroups.some((rows) => (
      property(rows[0], 'table_name') === table
      && usableIndex(rows, { unique: true })
      && sameValues(indexColumns(rows), columnsInUnique)
    ));
    if (!match) issues.push(indexIssue(table, 'unique', columnsInUnique));
  }
  for (const [table, prefix] of accessContract) {
    const match = indexGroups.some((rows) => (
      property(rows[0], 'table_name') === table
      && usableIndex(rows, { unique: false })
      && sameValues(indexColumns(rows).slice(0, prefix.length), prefix)
    ));
    if (!match) issues.push(indexIssue(table, 'access', prefix));
  }
}

function appendForeignKeyIssues(foreignKeyRows, requiredContract, issues) {
  const foreignKeys = orderedGroups(foreignKeyRows, 'constraint_name');
  const foreignKeyGroups = [...foreignKeys.values()];
  for (const required of requiredContract) {
    const [
      table,
      localColumns,
      referencedTable,
      referencedColumns,
      deleteRule,
      updateRule,
    ] = required;
    const match = foreignKeyGroups.some((rows) => (
      property(rows[0], 'table_name') === table
      && sameValues(
        rows.map((row) => property(row, 'column_name')),
        localColumns,
      )
      && rows.every((row) => (
        property(row, 'referenced_table_name') === referencedTable
        && String(property(row, 'delete_rule')).toUpperCase() === deleteRule
        && String(property(row, 'update_rule')).toUpperCase() === updateRule
      ))
      && sameValues(
        rows.map((row) => property(row, 'referenced_column_name')),
        referencedColumns,
      )
    ));
    if (!match) issues.push(foreignKeyIssue(required));
  }
}

async function verifySchema(database) {
  const {
    tableRows,
    columnRows,
    indexRows,
    foreignKeyRows,
  } = await collectSchemaMetadata(database);

  const issues = [];
  appendTableIssues(tableRows, Object.keys(COLUMN_CONTRACT), issues);
  const columns = appendColumnIssues(columnRows, COLUMN_CONTRACT, issues);

  for (const retiredField of [
    'messages.receiver_id',
    'messages.portfolio_id',
    'messages.read_at',
  ]) {
    if (columns.has(retiredField)) issues.push(`${retiredField} must not exist`);
  }

  appendIndexIssues(indexRows, issues, {
    primaryContract: PRIMARY_INDEX_CONTRACT,
    uniqueContract: UNIQUE_INDEX_CONTRACT,
    accessContract: ACCESS_INDEX_CONTRACT,
  });
  appendForeignKeyIssues(foreignKeyRows, FOREIGN_KEY_CONTRACT, issues);

  if (issues.length) {
    throw new Error(`Missing schema invariants: ${issues.join(', ')}`);
  }
  return true;
}

async function verifyPreservedCoreSchema(database) {
  const {
    tableRows,
    columnRows,
    indexRows,
    foreignKeyRows,
  } = await collectSchemaMetadata(database);
  const issues = [];
  const tableNames = [...PRESERVED_CORE_TABLES];
  appendTableIssues(tableRows, tableNames, issues);

  const columnContract = Object.fromEntries(tableNames.map((tableName) => [
    tableName,
    COLUMN_CONTRACT[tableName].filter((definition) => (
      tableName !== 'notifications'
      || !['related_conversation_id', 'related_message_id']
        .includes(definition.name)
    )),
  ]));
  appendColumnIssues(columnRows, columnContract, issues, {
    checkOrdinal: (tableName) => tableName !== 'notifications',
    allowedTypes: new Map([
      ['users.role', ALLOWED_MIGRATION_ROLE_TYPES],
      ['notifications.type', ALLOWED_MIGRATION_NOTIFICATION_TYPES],
    ]),
  });

  const preservedPrimary = PRIMARY_INDEX_CONTRACT.filter(([tableName]) => (
    PRESERVED_CORE_TABLES.has(tableName)
  ));
  const preservedUnique = UNIQUE_INDEX_CONTRACT.filter(([tableName]) => (
    PRESERVED_CORE_TABLES.has(tableName)
  ));
  const preservedAccess = ACCESS_INDEX_CONTRACT.filter(([tableName, columns]) => (
    PRESERVED_CORE_TABLES.has(tableName)
    && !(
      tableName === 'notifications'
      && ['related_conversation_id', 'related_message_id'].includes(columns[0])
    )
  ));
  appendIndexIssues(indexRows, issues, {
    primaryContract: preservedPrimary,
    uniqueContract: preservedUnique,
    accessContract: preservedAccess,
  });

  const preservedForeignKeys = FOREIGN_KEY_CONTRACT.filter((
    [tableName, columns],
  ) => (
    PRESERVED_CORE_TABLES.has(tableName)
    && !(
      tableName === 'notifications'
      && ['related_conversation_id', 'related_message_id'].includes(columns[0])
    )
  ));
  appendForeignKeyIssues(foreignKeyRows, preservedForeignKeys, issues);

  if (issues.length) {
    throw new Error(`Missing schema invariants: ${issues.join(', ')}`);
  }
  return true;
}

module.exports = {
  verifyPreservedCoreSchema,
  verifySchema,
};

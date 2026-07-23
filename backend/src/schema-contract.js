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

const REQUIRED_INDEXES = {
  'conversations.unique_conversation_portfolio': {
    unique: true,
    columns: ['portfolio_id'],
  },
  'conversation_members.PRIMARY': {
    unique: true,
    columns: ['conversation_id', 'user_id'],
  },
  'conversation_members.unique_conversation_singleton': {
    unique: true,
    columns: ['conversation_id', 'singleton_role'],
  },
  'messages.idx_messages_conversation_id': {
    unique: false,
    columns: ['conversation_id', 'id'],
  },
};

const REQUIRED_FOREIGN_KEYS = {
  'conversations.fk_conversations_portfolio': {
    columns: ['portfolio_id'],
    referencedTable: 'portfolios',
    referencedColumns: ['id'],
  },
  'conversations.fk_conversations_manager': {
    columns: ['relationship_manager_id'],
    referencedTable: 'users',
    referencedColumns: ['id'],
  },
  'conversation_members.fk_members_conversation': {
    columns: ['conversation_id'],
    referencedTable: 'conversations',
    referencedColumns: ['id'],
  },
  'conversation_members.fk_members_user': {
    columns: ['user_id'],
    referencedTable: 'users',
    referencedColumns: ['id'],
  },
  'messages.fk_messages_member': {
    columns: ['conversation_id', 'sender_id'],
    referencedTable: 'conversation_members',
    referencedColumns: ['conversation_id', 'user_id'],
  },
  'notifications.fk_notifications_conversation': {
    columns: ['related_conversation_id'],
    referencedTable: 'conversations',
    referencedColumns: ['id'],
  },
  'notifications.fk_notifications_message': {
    columns: ['related_message_id'],
    referencedTable: 'messages',
    referencedColumns: ['id'],
  },
};

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

function columnIssueLabel(field, attribute, expected) {
  if (attribute === 'type') return `${field} type must be ${expected}`;
  if (attribute === 'nullable') return `${field} nullability must be ${expected}`;
  if (attribute === 'default') return `${field} default must be ${expected}`;
  if (attribute === 'ordinal') return `${field} ordinal position must be ${expected}`;
  if (attribute === 'generation') return `${field} generation expression changed`;
  return `${field} ${attribute} changed`;
}

async function verifySchema(database) {
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
            COLUMN_NAME AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()`,
  );
  const [foreignKeyRows] = await database.query(
    `SELECT TABLE_NAME AS table_name,
            CONSTRAINT_NAME AS constraint_name,
            COLUMN_NAME AS column_name,
            REFERENCED_TABLE_NAME AS referenced_table_name,
            REFERENCED_COLUMN_NAME AS referenced_column_name,
            ORDINAL_POSITION AS ordinal_position
       FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE()
        AND referenced_table_name IS NOT NULL`,
  );

  const issues = [];
  const tables = new Map(tableRows.map((row) => [
    property(row, 'table_name'),
    row,
  ]));
  for (const tableName of Object.keys(COLUMN_CONTRACT)) {
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

  const columns = new Map(columnRows.map((actual) => [
    `${property(actual, 'table_name')}.${property(actual, 'column_name')}`,
    actual,
  ]));
  for (const [tableName, definitions] of Object.entries(COLUMN_CONTRACT)) {
    for (const expected of definitions) {
      const field = `${tableName}.${expected.name}`;
      const actual = columns.get(field);
      if (!actual) {
        issues.push(`${field} must exist`);
        continue;
      }
      if (Number(property(actual, 'ordinal_position')) !== expected.ordinalPosition) {
        issues.push(columnIssueLabel(
          field,
          'ordinal',
          expected.ordinalPosition,
        ));
      }
      if (normalizeSqlText(property(actual, 'column_type')) !== normalizeSqlText(expected.type)) {
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

  for (const retiredField of [
    'messages.receiver_id',
    'messages.portfolio_id',
    'messages.read_at',
  ]) {
    if (columns.has(retiredField)) issues.push(`${retiredField} must not exist`);
  }

  const indexes = orderedGroups(indexRows, 'index_name');
  for (const [key, required] of Object.entries(REQUIRED_INDEXES)) {
    const rows = indexes.get(key);
    if (!rows) {
      issues.push(key);
      continue;
    }
    const columnsInIndex = rows.map((row) => property(row, 'column_name'));
    const unique = Number(property(rows[0], 'non_unique')) === 0;
    if (!sameValues(columnsInIndex, required.columns) || unique !== required.unique) {
      issues.push(key);
    }
  }

  const foreignKeys = orderedGroups(foreignKeyRows, 'constraint_name');
  for (const [key, required] of Object.entries(REQUIRED_FOREIGN_KEYS)) {
    const rows = foreignKeys.get(key);
    if (!rows) {
      issues.push(key);
      continue;
    }
    const local = rows.map((row) => property(row, 'column_name'));
    const referenced = rows.map((row) => property(row, 'referenced_column_name'));
    const referencedTable = property(rows[0], 'referenced_table_name');
    if (
      !sameValues(local, required.columns)
      || !sameValues(referenced, required.referencedColumns)
      || referencedTable !== required.referencedTable
    ) {
      issues.push(key);
    }
  }

  if (issues.length) {
    throw new Error(`Missing schema invariants: ${issues.join(', ')}`);
  }
  return true;
}

module.exports = {
  verifySchema,
};

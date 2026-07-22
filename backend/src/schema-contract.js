const REQUIRED_COLUMNS = {
  users: ['id', 'email', 'password_hash', 'name', 'role', 'created_at', 'updated_at'],
  portfolios: [
    'id',
    'owner_id',
    'name',
    'sector',
    'description',
    'mvp_status',
    'funding_goal',
    'team_size',
    'founded_year',
    'location',
    'website',
    'monthly_revenue',
    'user_count',
    'growth_rate',
    'market_size',
    'competitor_analysis',
    'advisor_names',
    'burn_rate',
    'runway_months',
    'readiness_score',
    'status',
    'rejection_reason',
    'submitted_at',
    'created_at',
    'updated_at',
  ],
  portfolio_documents: [
    'id',
    'portfolio_id',
    'file_name',
    'file_url',
    'file_type',
    'uploaded_at',
  ],
  investor_interests: ['id', 'investor_id', 'portfolio_id', 'created_at'],
  conversations: [
    'id',
    'portfolio_id',
    'relationship_manager_id',
    'title',
    'status',
    'archived_reason',
    'created_at',
    'updated_at',
  ],
  conversation_members: [
    'conversation_id',
    'user_id',
    'member_role',
    'singleton_role',
    'membership_status',
    'joined_at',
    'left_at',
    'visible_after_message_id',
    'last_read_message_id',
  ],
  messages: ['id', 'conversation_id', 'sender_id', 'content', 'created_at'],
  notifications: [
    'id',
    'user_id',
    'type',
    'title',
    'body',
    'related_portfolio_id',
    'related_conversation_id',
    'related_message_id',
    'related_user_id',
    'read_at',
    'created_at',
  ],
  audit_logs: ['id', 'admin_id', 'action', 'portfolio_id', 'reason', 'created_at'],
};

const REQUIRED_ENUMS = {
  'users.role': ['business_owner', 'investor', 'relationship_manager', 'admin'],
  'conversations.status': ['active', 'archived'],
  'conversations.archived_reason': [
    'manual',
    'no_active_investors',
    'portfolio_unapproved',
    'portfolio_deleted',
  ],
  'conversation_members.member_role': [
    'relationship_manager',
    'business_owner',
    'investor',
  ],
  'conversation_members.membership_status': ['active', 'removed'],
  'notifications.type': [
    'new_message',
    'new_interest',
    'portfolio_approved',
    'portfolio_rejected',
    'portfolio_needs_changes',
    'portfolio_submitted',
    'conversation_created',
    'conversation_member_added',
    'conversation_archived',
  ],
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

function property(row, lower, upper) {
  return row[lower] ?? row[upper];
}

function enumValues(columnType) {
  const values = [];
  const pattern = /'((?:''|[^'])*)'/g;
  let match = pattern.exec(String(columnType || ''));
  while (match) {
    values.push(match[1].replace(/''/g, "'"));
    match = pattern.exec(String(columnType || ''));
  }
  return values;
}

function orderedGroups(rows, nameProperty) {
  const groups = new Map();
  for (const row of rows) {
    const table = property(row, 'table_name', 'TABLE_NAME');
    const name = property(row, nameProperty, nameProperty.toUpperCase());
    const key = `${table}.${name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => Number(
      property(left, 'seq_in_index', 'SEQ_IN_INDEX')
        ?? property(left, 'ordinal_position', 'ORDINAL_POSITION'),
    ) - Number(
      property(right, 'seq_in_index', 'SEQ_IN_INDEX')
        ?? property(right, 'ordinal_position', 'ORDINAL_POSITION'),
    ));
  }
  return groups;
}

function sameValues(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

async function verifySchema(database) {
  const [columnRows] = await database.query(
    `SELECT TABLE_NAME AS table_name,
            COLUMN_NAME AS column_name,
            IS_NULLABLE AS is_nullable,
            COLUMN_TYPE AS column_type,
            EXTRA AS extra
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

  const columns = new Map(columnRows.map((row) => [
    `${property(row, 'table_name', 'TABLE_NAME')}.${property(row, 'column_name', 'COLUMN_NAME')}`,
    row,
  ]));
  const missingFields = [];
  for (const [table, names] of Object.entries(REQUIRED_COLUMNS)) {
    for (const name of names) {
      if (!columns.has(`${table}.${name}`)) missingFields.push(`${table}.${name}`);
    }
  }
  if (missingFields.length) {
    throw new Error(`Missing schema fields: ${missingFields.join(', ')}`);
  }

  const issues = [];
  for (const field of [
    'messages.conversation_id',
    'messages.sender_id',
    'messages.content',
  ]) {
    if (property(columns.get(field), 'is_nullable', 'IS_NULLABLE') !== 'NO') {
      issues.push(`${field} must be NOT NULL`);
    }
  }

  const retiredMessageFields = [
    ['receiver', 'id'],
    ['portfolio', 'id'],
    ['read', 'at'],
  ].map((parts) => `messages.${parts.join('_')}`);
  for (const directField of retiredMessageFields) {
    if (columns.has(directField)) issues.push(`${directField} must not exist`);
  }

  const singleton = columns.get('conversation_members.singleton_role');
  if (!String(property(singleton, 'extra', 'EXTRA') || '').toUpperCase().includes('GENERATED')) {
    issues.push('conversation_members.singleton_role must be generated');
  }

  for (const [field, requiredValues] of Object.entries(REQUIRED_ENUMS)) {
    const actual = new Set(enumValues(property(columns.get(field), 'column_type', 'COLUMN_TYPE')));
    for (const value of requiredValues) {
      if (!actual.has(value)) issues.push(`${field} missing enum value ${value}`);
    }
  }

  const indexes = orderedGroups(indexRows, 'index_name');
  for (const [key, required] of Object.entries(REQUIRED_INDEXES)) {
    const rows = indexes.get(key);
    if (!rows) {
      issues.push(key);
      continue;
    }
    const columnsInIndex = rows.map((row) => property(row, 'column_name', 'COLUMN_NAME'));
    const unique = Number(property(rows[0], 'non_unique', 'NON_UNIQUE')) === 0;
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
    const local = rows.map((row) => property(row, 'column_name', 'COLUMN_NAME'));
    const referenced = rows.map((row) => property(
      row,
      'referenced_column_name',
      'REFERENCED_COLUMN_NAME',
    ));
    const referencedTable = property(
      rows[0],
      'referenced_table_name',
      'REFERENCED_TABLE_NAME',
    );
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
  REQUIRED_COLUMNS,
  REQUIRED_ENUMS,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_INDEXES,
  verifySchema,
};

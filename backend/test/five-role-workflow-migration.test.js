const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  cloneProductionSchemaMetadata,
} = require('./helpers/schema-metadata-harness');

const backendRoot = path.join(__dirname, '..');
const migrationPath = path.join(
  backendRoot,
  'scripts',
  'migrate-five-role-workflow.js',
);
const {
  FiveRoleMigrationError,
  assertMigrationGuards,
  migrateFiveRoleWorkflow,
} = require(migrationPath);

const confirmedEnvironment = {
  WORKFLOW_BACKUP_VERIFIED: 'BACKUP_AND_RESTORE_COMMAND_VERIFIED',
  CONFIRM_FIVE_ROLE_WORKFLOW_MIGRATION:
    'APPLY_LUMILABS_FIVE_ROLE_WORKFLOW_20260727',
};

const protectedTables = [
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

const defaultCounts = Object.fromEntries(
  protectedTables.map((tableName, index) => [tableName, (index + 1) * 11]),
);

const defaultMessageIdentities = [
  { id: 101, conversation_id: 7, sender_id: 3 },
  { id: 104, conversation_id: 7, sender_id: 8 },
];

const defaultMemberIdentities = [
  { conversation_id: 7, user_id: 3 },
  { conversation_id: 7, user_id: 8 },
  { conversation_id: 7, user_id: 12 },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function metadataRow(metadata, tableName, columnName) {
  return metadata.columns.find((candidate) => (
    candidate.table_name === tableName
    && candidate.column_name === columnName
  ));
}

function priorMetadata() {
  const metadata = cloneProductionSchemaMetadata();
  metadata.tables = metadata.tables.filter(({ table_name: tableName }) => (
    tableName !== 'superadmin_audit_logs'
  ));
  metadata.columns = metadata.columns.filter((candidate) => (
    candidate.table_name !== 'superadmin_audit_logs'
    && !(
      candidate.table_name === 'portfolios'
      && candidate.column_name === 'relationship_manager_id'
    )
  ));
  metadata.indexes = metadata.indexes.filter((candidate) => (
    candidate.table_name !== 'superadmin_audit_logs'
    && !(
      candidate.table_name === 'portfolios'
      && candidate.column_name === 'relationship_manager_id'
    )
  ));
  metadata.foreignKeys = metadata.foreignKeys.filter((candidate) => (
    candidate.table_name !== 'superadmin_audit_logs'
    && !(
      candidate.table_name === 'portfolios'
      && candidate.column_name === 'relationship_manager_id'
    )
  ));
  metadataRow(metadata, 'users', 'role').column_type =
    "enum('business_owner','investor','relationship_manager','admin')";
  metadataRow(metadata, 'notifications', 'type').column_type =
    "enum('new_message','new_interest','portfolio_approved','portfolio_rejected',"
    + "'portfolio_needs_changes','portfolio_submitted','conversation_created',"
    + "'conversation_member_added','conversation_archived')";
  metadataRow(
    metadata,
    'conversation_members',
    'singleton_role',
  ).generation_expression =
    "(case when (`member_role` in (_utf8mb4'relationship_manager',"
    + "_utf8mb4'business_owner')) then `member_role` else NULL end)";
  return metadata;
}

function partiallyAppliedMetadata() {
  const metadata = priorMetadata();
  const finalMetadata = cloneProductionSchemaMetadata();
  metadataRow(metadata, 'users', 'role').column_type =
    metadataRow(finalMetadata, 'users', 'role').column_type;
  metadata.columns.push(clone(
    metadataRow(finalMetadata, 'portfolios', 'relationship_manager_id'),
  ));
  metadata.indexes.push(...clone(finalMetadata.indexes.filter((candidate) => (
    candidate.table_name === 'portfolios'
    && candidate.column_name === 'relationship_manager_id'
  ))));
  metadata.foreignKeys.push(...clone(
    finalMetadata.foreignKeys.filter((candidate) => (
      candidate.table_name === 'portfolios'
      && candidate.column_name === 'relationship_manager_id'
    )),
  ));
  return metadata;
}

function replaceRows(metadata, finalMetadata, collection, predicate) {
  metadata[collection] = metadata[collection].filter(
    (candidate) => !predicate(candidate),
  );
  metadata[collection].push(...clone(
    finalMetadata[collection].filter(predicate),
  ));
}

function metadataAfterCheckpoint(checkpoint) {
  const checkpoints = [
    'role',
    'portfolio_column',
    'portfolio_index',
    'portfolio_foreign_key',
    'backfill',
    'singleton',
    'notification',
    'audit_table',
  ];
  const reached = checkpoints.indexOf(checkpoint);
  assert.notEqual(reached, -1, `Unknown migration checkpoint: ${checkpoint}`);

  const metadata = priorMetadata();
  const finalMetadata = cloneProductionSchemaMetadata();
  if (reached >= checkpoints.indexOf('role')) {
    replaceRows(
      metadata,
      finalMetadata,
      'columns',
      (row) => row.table_name === 'users' && row.column_name === 'role',
    );
  }
  if (reached >= checkpoints.indexOf('portfolio_column')) {
    replaceRows(
      metadata,
      finalMetadata,
      'columns',
      (row) => (
        row.table_name === 'portfolios'
        && row.column_name === 'relationship_manager_id'
      ),
    );
  }
  if (reached >= checkpoints.indexOf('portfolio_index')) {
    replaceRows(
      metadata,
      finalMetadata,
      'indexes',
      (row) => (
        row.table_name === 'portfolios'
        && row.index_name === 'fk_relationship_manager'
      ),
    );
  }
  if (reached >= checkpoints.indexOf('portfolio_foreign_key')) {
    replaceRows(
      metadata,
      finalMetadata,
      'foreignKeys',
      (row) => (
        row.table_name === 'portfolios'
        && row.constraint_name === 'fk_relationship_manager'
      ),
    );
  }
  if (reached >= checkpoints.indexOf('singleton')) {
    replaceRows(
      metadata,
      finalMetadata,
      'columns',
      (row) => (
        row.table_name === 'conversation_members'
        && row.column_name === 'singleton_role'
      ),
    );
  }
  if (reached >= checkpoints.indexOf('notification')) {
    replaceRows(
      metadata,
      finalMetadata,
      'columns',
      (row) => row.table_name === 'notifications' && row.column_name === 'type',
    );
  }
  if (reached >= checkpoints.indexOf('audit_table')) {
    for (const collection of [
      'tables',
      'columns',
      'indexes',
      'foreignKeys',
    ]) {
      replaceRows(
        metadata,
        finalMetadata,
        collection,
        (row) => row.table_name === 'superadmin_audit_logs',
      );
    }
  }
  return metadata;
}

function priorMetadataWithFinalAuditTable() {
  const metadata = priorMetadata();
  const finalMetadata = cloneProductionSchemaMetadata();
  for (const collection of [
    'tables',
    'columns',
    'indexes',
    'foreignKeys',
  ]) {
    replaceRows(
      metadata,
      finalMetadata,
      collection,
      (row) => row.table_name === 'superadmin_audit_logs',
    );
  }
  return metadata;
}

function migrationHarness(
  initialMetadata,
  {
    managerConflicts = [],
    invalidAssignees = [],
    orphanAssignees = [],
    duplicateActiveSingletons = [],
    nullAssignments = 0,
    beforeCounts = defaultCounts,
    afterCounts = beforeCounts,
    beforeMessageIdentities = defaultMessageIdentities,
    afterMessageIdentities = beforeMessageIdentities,
    beforeMemberIdentities = defaultMemberIdentities,
    afterMemberIdentities = beforeMemberIdentities,
    lockAcquired = true,
  } = {},
) {
  const metadata = clone(initialMetadata);
  const finalMetadata = cloneProductionSchemaMetadata();
  const initialTableNames = new Set(
    metadata.tables.map(({ table_name: tableName }) => tableName),
  );
  const effectiveBeforeCounts = { ...beforeCounts };
  const effectiveAfterCounts = { ...afterCounts };
  for (const tableName of protectedTables) {
    if (!initialTableNames.has(tableName)) {
      effectiveBeforeCounts[tableName] = 0;
      if (afterCounts === beforeCounts) effectiveAfterCounts[tableName] = 0;
    }
  }
  const queries = [];
  const mutations = [];
  const countReads = new Map();
  let messageIdentityReads = 0;
  let memberIdentityReads = 0;
  let remainingNullAssignments = nullAssignments;
  let releaseCount = 0;

  function metadataResult(source, params) {
    if (/information_schema\.tables/i.test(source)) {
      const tableName = params[0];
      return tableName
        ? metadata.tables.filter((row) => row.table_name === tableName)
        : metadata.tables;
    }
    if (/information_schema\.columns/i.test(source)) {
      const [tableName, columnName] = params;
      return metadata.columns.filter((row) => (
        (!tableName || row.table_name === tableName)
        && (!columnName || row.column_name === columnName)
      ));
    }
    if (/information_schema\.statistics/i.test(source)) {
      const [tableName, indexName] = params;
      return metadata.indexes.filter((row) => (
        (!tableName || row.table_name === tableName)
        && (!indexName || row.index_name === indexName)
      ));
    }
    if (/information_schema\.key_column_usage/i.test(source)) {
      const [tableName, constraintName] = params;
      return metadata.foreignKeys.filter((row) => (
        (!tableName || row.table_name === tableName)
        && (!constraintName || row.constraint_name === constraintName)
      ));
    }
    return null;
  }

  function applyMutation(source) {
    if (/ALTER TABLE users\s+MODIFY (?:COLUMN )?role/i.test(source)) {
      replaceRows(
        metadata,
        finalMetadata,
        'columns',
        (row) => row.table_name === 'users' && row.column_name === 'role',
      );
      return;
    }
    if (
      /ALTER TABLE portfolios\s+(?:ADD|MODIFY) (?:COLUMN )?relationship_manager_id/i
        .test(source)
    ) {
      replaceRows(
        metadata,
        finalMetadata,
        'columns',
        (row) => (
          row.table_name === 'portfolios'
          && row.column_name === 'relationship_manager_id'
        ),
      );
      return;
    }
    if (
      /ALTER TABLE portfolios\s+ADD (?:KEY|INDEX) fk_relationship_manager/i
        .test(source)
    ) {
      replaceRows(
        metadata,
        finalMetadata,
        'indexes',
        (row) => (
          row.table_name === 'portfolios'
          && row.index_name === 'fk_relationship_manager'
        ),
      );
      return;
    }
    if (
      /ALTER TABLE portfolios\s+ADD CONSTRAINT fk_relationship_manager/i
        .test(source)
    ) {
      replaceRows(
        metadata,
        finalMetadata,
        'foreignKeys',
        (row) => (
          row.table_name === 'portfolios'
          && row.constraint_name === 'fk_relationship_manager'
        ),
      );
      return;
    }
    if (
      /ALTER TABLE conversation_members\s+MODIFY (?:COLUMN )?singleton_role/i
        .test(source)
    ) {
      replaceRows(
        metadata,
        finalMetadata,
        'columns',
        (row) => (
          row.table_name === 'conversation_members'
          && row.column_name === 'singleton_role'
        ),
      );
      return;
    }
    if (
      /ALTER TABLE conversation_members\s+ADD UNIQUE (?:KEY|INDEX) unique_conversation_singleton/i
        .test(source)
    ) {
      replaceRows(
        metadata,
        finalMetadata,
        'indexes',
        (row) => (
          row.table_name === 'conversation_members'
          && row.index_name === 'unique_conversation_singleton'
        ),
      );
      return;
    }
    if (/ALTER TABLE notifications\s+MODIFY (?:COLUMN )?type/i.test(source)) {
      replaceRows(
        metadata,
        finalMetadata,
        'columns',
        (row) => (
          row.table_name === 'notifications'
          && row.column_name === 'type'
        ),
      );
      return;
    }
    if (/CREATE TABLE superadmin_audit_logs/i.test(source)) {
      for (const collection of [
        'tables',
        'columns',
        'indexes',
        'foreignKeys',
      ]) {
        replaceRows(
          metadata,
          finalMetadata,
          collection,
          (row) => row.table_name === 'superadmin_audit_logs',
        );
      }
    }
  }

  const connection = {
    metadata,
    queries,
    mutations,
    get releaseCount() {
      return releaseCount;
    },
    async query(sql, params = []) {
      const source = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: source, params: clone(params) });

      if (/^SELECT GET_LOCK\(/i.test(source)) {
        return [[{ acquired: lockAcquired ? 1 : 0 }], []];
      }
      if (/^SELECT RELEASE_LOCK\(/i.test(source)) {
        releaseCount += 1;
        return [[{ released: 1 }], []];
      }

      const metadataRows = metadataResult(source, params);
      if (metadataRows) return [clone(metadataRows), []];

      if (
        /p\.relationship_manager_id/i.test(source)
        && !metadataRow(metadata, 'portfolios', 'relationship_manager_id')
      ) {
        throw new Error(
          "Unknown column 'p.relationship_manager_id' in 'field list'",
        );
      }
      if (/AS portfolio_manager_id/i.test(source)) {
        return [clone(managerConflicts), []];
      }
      if (/AS assigned_user_role/i.test(source)) {
        if (orphanAssignees.length) {
          const preservesOrphans = (
            /LEFT JOIN users u/i.test(source)
            && /u\.id IS NULL/i.test(source)
          );
          return [preservesOrphans ? clone(orphanAssignees) : [], []];
        }
        return [clone(invalidAssignees), []];
      }
      if (/AS duplicate_count/i.test(source)) {
        return [clone(duplicateActiveSingletons), []];
      }
      if (
        /SELECT COUNT\(\*\) AS count FROM portfolios p JOIN conversations c/i
          .test(source)
        && /p\.relationship_manager_id IS NULL/i.test(source)
      ) {
        return [[{ count: remainingNullAssignments }], []];
      }
      if (
        /^SELECT id, conversation_id, sender_id FROM messages ORDER BY id$/i
          .test(source)
      ) {
        const rows = messageIdentityReads === 0
          ? beforeMessageIdentities
          : afterMessageIdentities;
        messageIdentityReads += 1;
        return [clone(rows), []];
      }
      if (
        /^SELECT conversation_id, user_id FROM conversation_members ORDER BY conversation_id, user_id$/i
          .test(source)
      ) {
        const rows = memberIdentityReads === 0
          ? beforeMemberIdentities
          : afterMemberIdentities;
        memberIdentityReads += 1;
        return [clone(rows), []];
      }
      const countMatch = source.match(
        /^SELECT COUNT\(\*\) AS count FROM `?([a-z_]+)`?$/i,
      );
      if (countMatch) {
        const tableName = countMatch[1];
        if (!metadata.tables.some((row) => row.table_name === tableName)) {
          throw new Error(`Table '${tableName}' doesn't exist`);
        }
        const reads = countReads.get(tableName) || 0;
        countReads.set(tableName, reads + 1);
        return [[{
          count: reads === 0
            ? (
              initialTableNames.has(tableName)
                ? effectiveBeforeCounts[tableName]
                : effectiveAfterCounts[tableName]
            )
            : effectiveAfterCounts[tableName],
        }], []];
      }

      if (
        /^UPDATE portfolios p JOIN conversations c ON c\.portfolio_id = p\.id SET p\.relationship_manager_id = c\.relationship_manager_id WHERE p\.relationship_manager_id IS NULL$/i
          .test(source)
      ) {
        mutations.push(source);
        const affectedRows = remainingNullAssignments;
        remainingNullAssignments = 0;
        return [{ affectedRows }, []];
      }

      if (/^(?:ALTER|CREATE|UPDATE|DELETE|TRUNCATE|DROP|INSERT)\b/i.test(source)) {
        mutations.push(source);
        applyMutation(source);
        return [{ affectedRows: 0 }, []];
      }

      throw new Error(`Unexpected migration query: ${source}`);
    },
  };
  return connection;
}

test('migration guards require both exact deployment confirmations without querying', async () => {
  assert.throws(
    () => assertMigrationGuards({}),
    (error) => (
      error instanceof FiveRoleMigrationError
      && error.code === 'BACKUP_NOT_VERIFIED'
    ),
  );
  assert.throws(
    () => assertMigrationGuards({
      WORKFLOW_BACKUP_VERIFIED: confirmedEnvironment.WORKFLOW_BACKUP_VERIFIED,
    }),
    (error) => (
      error instanceof FiveRoleMigrationError
      && error.code === 'CONFIRMATION_REQUIRED'
    ),
  );
  assert.equal(assertMigrationGuards(confirmedEnvironment), true);

  let queries = 0;
  await assert.rejects(
    migrateFiveRoleWorkflow({
      async query() {
        queries += 1;
      },
    }, {}),
    (error) => error.code === 'BACKUP_NOT_VERIFIED',
  );
  assert.equal(queries, 0);
});

test('already migrated metadata is a no-op and preserves identities', async () => {
  const connection = migrationHarness(cloneProductionSchemaMetadata());
  const result = await migrateFiveRoleWorkflow(
    connection,
    confirmedEnvironment,
  );

  assert.deepEqual(result.changed, []);
  assert.equal(result.backfilled_assignments, 0);
  assert.deepEqual(result.after, result.before);
  assert.equal(connection.mutations.length, 0);
  assert.equal(connection.releaseCount, 1);
});

test('manager mismatch aborts before schema or data mutation', async () => {
  const connection = migrationHarness(partiallyAppliedMetadata(), {
    managerConflicts: [{
      portfolio_id: 9,
      portfolio_manager_id: 4,
      conversation_manager_id: 7,
    }],
  });

  await assert.rejects(
    migrateFiveRoleWorkflow(connection, confirmedEnvironment),
    (error) => error.code === 'ASSIGNMENT_CONFLICT',
  );
  assert.deepEqual(connection.mutations, []);
  assert.equal(connection.releaseCount, 1);
});

test('non-relationship-manager assignments abort before mutation', async () => {
  const connection = migrationHarness(priorMetadata(), {
    invalidAssignees: [{
      portfolio_id: 12,
      relationship_manager_id: 5,
      assigned_user_role: 'admin',
    }],
  });

  await assert.rejects(
    migrateFiveRoleWorkflow(connection, confirmedEnvironment),
    (error) => error.code === 'ASSIGNEE_ROLE_INVALID',
  );
  assert.deepEqual(connection.mutations, []);
});

test('orphan portfolio manager IDs abort before mutation', async () => {
  const connection = migrationHarness(partiallyAppliedMetadata(), {
    orphanAssignees: [{
      portfolio_id: 14,
      relationship_manager_id: 999,
      assigned_user_id: null,
      assigned_user_role: null,
    }],
  });

  await assert.rejects(
    migrateFiveRoleWorkflow(connection, confirmedEnvironment),
    (error) => error.code === 'ASSIGNEE_ROLE_INVALID',
  );
  assert.deepEqual(connection.mutations, []);
  assert.equal(connection.releaseCount, 1);
});

test('duplicate active singleton members abort before mutation', async () => {
  const connection = migrationHarness(priorMetadata(), {
    duplicateActiveSingletons: [{
      conversation_id: 2,
      member_role: 'business_owner',
      duplicate_count: 2,
    }],
  });

  await assert.rejects(
    migrateFiveRoleWorkflow(connection, confirmedEnvironment),
    (error) => error.code === 'DUPLICATE_ACTIVE_SINGLETON',
  );
  assert.deepEqual(connection.mutations, []);
});

test('known prior and final singleton expressions are classified exactly', async () => {
  const priorConnection = migrationHarness(priorMetadata());
  const priorResult = await migrateFiveRoleWorkflow(
    priorConnection,
    confirmedEnvironment,
  );
  assert.ok(
    priorResult.changed.includes('conversation_members.singleton_role'),
  );

  const finalConnection = migrationHarness(cloneProductionSchemaMetadata());
  const finalResult = await migrateFiveRoleWorkflow(
    finalConnection,
    confirmedEnvironment,
  );
  assert.deepEqual(finalResult.changed, []);
  assert.deepEqual(finalConnection.mutations, []);
});

test('singleton expressions with extra predicates fail preflight without mutation', async () => {
  const metadata = priorMetadata();
  metadataRow(
    metadata,
    'conversation_members',
    'singleton_role',
  ).generation_expression =
    "(case when ((`membership_status` = _utf8mb4'active') and "
    + "(`member_role` in (_utf8mb4'relationship_manager',"
    + "_utf8mb4'business_owner')) and (1 = 1)) "
    + 'then `member_role` else NULL end)';
  const connection = migrationHarness(metadata);

  await assert.rejects(
    migrateFiveRoleWorkflow(connection, confirmedEnvironment),
    (error) => error.code === 'SINGLETON_EXPRESSION_INVALID',
  );
  assert.deepEqual(connection.mutations, []);
  assert.equal(connection.releaseCount, 1);
});

for (const { label, mutate } of [
  {
    label: 'wrong table engine',
    mutate(metadata) {
      metadata.tables.find((row) => (
        row.table_name === 'superadmin_audit_logs'
      )).engine = 'MyISAM';
    },
  },
  {
    label: 'view in place of the table',
    mutate(metadata) {
      metadata.tables.find((row) => (
        row.table_name === 'superadmin_audit_logs'
      )).table_type = 'VIEW';
    },
  },
  {
    label: 'column drift',
    mutate(metadata) {
      metadataRow(metadata, 'superadmin_audit_logs', 'action').column_type =
        "enum('portfolio_assigned','unexpected')";
    },
  },
  {
    label: 'index drift',
    mutate(metadata) {
      metadata.indexes.find((row) => (
        row.table_name === 'superadmin_audit_logs'
        && row.index_name === 'idx_superadmin_audit_created_user'
      )).column_name = 'created_user_id_snapshot';
    },
  },
  {
    label: 'foreign-key drift',
    mutate(metadata) {
      metadata.foreignKeys.find((row) => (
        row.table_name === 'superadmin_audit_logs'
        && row.constraint_name === 'fk_superadmin_audit_actor'
      )).delete_rule = 'CASCADE';
    },
  },
]) {
  test(`existing superadmin audit ${label} fails before mutation`, async () => {
    const metadata = priorMetadataWithFinalAuditTable();
    mutate(metadata);
    const connection = migrationHarness(metadata);

    await assert.rejects(
      migrateFiveRoleWorkflow(connection, confirmedEnvironment),
      (error) => error.code === 'SUPERADMIN_AUDIT_SCHEMA_DRIFT',
    );
    assert.deepEqual(connection.mutations, []);
    assert.equal(connection.releaseCount, 1);
  });
}

test('prior metadata upgrades additively and backfills null assignments only', async () => {
  const connection = migrationHarness(priorMetadata(), {
    nullAssignments: 2,
  });
  const result = await migrateFiveRoleWorkflow(
    connection,
    confirmedEnvironment,
  );

  assert.equal(result.backfilled_assignments, 2);
  assert.deepEqual(result.after, result.before);
  assert.deepEqual(result.changed, [
    'users.role',
    'portfolios.relationship_manager_id',
    'portfolios.fk_relationship_manager.index',
    'portfolios.fk_relationship_manager.foreign_key',
    'conversation_members.singleton_role',
    'notifications.type',
    'superadmin_audit_logs',
  ]);
  const updates = connection.mutations.filter((sql) => (
    /^UPDATE portfolios p/i.test(sql)
  ));
  assert.equal(updates.length, 1);
  assert.match(updates[0], /WHERE p\.relationship_manager_id IS NULL$/i);
  assert.doesNotMatch(updates[0], /IS NOT NULL/i);
});

for (const checkpoint of [
  {
    name: 'role',
    nullAssignments: 2,
    changed: [
      'portfolios.relationship_manager_id',
      'portfolios.fk_relationship_manager.index',
      'portfolios.fk_relationship_manager.foreign_key',
      'conversation_members.singleton_role',
      'notifications.type',
      'superadmin_audit_logs',
    ],
    backfilled: 2,
  },
  {
    name: 'portfolio_column',
    nullAssignments: 2,
    changed: [
      'portfolios.fk_relationship_manager.index',
      'portfolios.fk_relationship_manager.foreign_key',
      'conversation_members.singleton_role',
      'notifications.type',
      'superadmin_audit_logs',
    ],
    backfilled: 2,
  },
  {
    name: 'portfolio_index',
    nullAssignments: 2,
    changed: [
      'portfolios.fk_relationship_manager.foreign_key',
      'conversation_members.singleton_role',
      'notifications.type',
      'superadmin_audit_logs',
    ],
    backfilled: 2,
  },
  {
    name: 'portfolio_foreign_key',
    nullAssignments: 2,
    changed: [
      'conversation_members.singleton_role',
      'notifications.type',
      'superadmin_audit_logs',
    ],
    backfilled: 2,
  },
  {
    name: 'backfill',
    nullAssignments: 0,
    changed: [
      'conversation_members.singleton_role',
      'notifications.type',
      'superadmin_audit_logs',
    ],
    backfilled: 0,
  },
  {
    name: 'singleton',
    nullAssignments: 0,
    changed: [
      'notifications.type',
      'superadmin_audit_logs',
    ],
    backfilled: 0,
  },
  {
    name: 'notification',
    nullAssignments: 0,
    changed: ['superadmin_audit_logs'],
    backfilled: 0,
  },
  {
    name: 'audit_table',
    nullAssignments: 0,
    changed: [],
    backfilled: 0,
  },
]) {
  test(`rerun after ${checkpoint.name} checkpoint converges then is mutation-free`, async () => {
    const connection = migrationHarness(
      metadataAfterCheckpoint(checkpoint.name),
      { nullAssignments: checkpoint.nullAssignments },
    );
    const first = await migrateFiveRoleWorkflow(
      connection,
      confirmedEnvironment,
    );

    assert.deepEqual(first.changed, checkpoint.changed);
    assert.equal(first.backfilled_assignments, checkpoint.backfilled);
    assert.deepEqual(first.after, first.before);

    const mutationCount = connection.mutations.length;
    const second = await migrateFiveRoleWorkflow(
      connection,
      confirmedEnvironment,
    );
    assert.deepEqual(second.changed, []);
    assert.equal(second.backfilled_assignments, 0);
    assert.equal(connection.mutations.length, mutationCount);
    assert.equal(connection.releaseCount, 2);
  });
}

test('protected row count drift is rejected after final verification', async () => {
  const afterCounts = { ...defaultCounts, messages: defaultCounts.messages - 1 };
  const connection = migrationHarness(cloneProductionSchemaMetadata(), {
    afterCounts,
  });

  await assert.rejects(
    migrateFiveRoleWorkflow(connection, confirmedEnvironment),
    (error) => error.code === 'PROTECTED_ROWS_CHANGED',
  );
  assert.equal(connection.releaseCount, 1);
});

test('message and member identity drift is rejected exactly', async () => {
  const connection = migrationHarness(cloneProductionSchemaMetadata(), {
    afterMessageIdentities: [
      defaultMessageIdentities[0],
      { id: 104, conversation_id: 99, sender_id: 8 },
    ],
  });

  await assert.rejects(
    migrateFiveRoleWorkflow(connection, confirmedEnvironment),
    (error) => error.code === 'PROTECTED_IDENTITIES_CHANGED',
  );

  const memberConnection = migrationHarness(cloneProductionSchemaMetadata(), {
    afterMemberIdentities: [
      defaultMemberIdentities[0],
      defaultMemberIdentities[1],
    ],
  });
  await assert.rejects(
    migrateFiveRoleWorkflow(memberConnection, confirmedEnvironment),
    (error) => error.code === 'PROTECTED_IDENTITIES_CHANGED',
  );
});

test('generated migration SQL cannot reset protected data or convert roles', () => {
  const source = fs.readFileSync(migrationPath, 'utf8');
  assert.doesNotMatch(source, /DROP\s+TABLE/i);
  assert.doesNotMatch(source, /TRUNCATE/i);
  assert.doesNotMatch(
    source,
    /DELETE\s+FROM\s+(messages|conversation_members|conversations)/i,
  );
  assert.doesNotMatch(
    source,
    /SET\s+role\s*=\s*['"]admin['"].*superadmin/is,
  );
});

test('only the guarded five-role migration remains reachable', () => {
  const migrateSource = fs.readFileSync(
    path.join(backendRoot, 'migrate.js'),
    'utf8',
  );
  const packageJson = JSON.parse(fs.readFileSync(
    path.join(backendRoot, 'package.json'),
    'utf8',
  ));

  assert.equal(
    fs.existsSync(path.join(backendRoot, 'scripts', 'migrate-managed-chat.js')),
    false,
  );
  assert.match(migrateSource, /migrate-five-role-workflow/);
  assert.doesNotMatch(migrateSource, /migrate-managed-chat|migrateManagedChat/);
  assert.equal(
    packageJson.scripts['migrate:five-role-workflow'],
    'node migrate.js',
  );
  assert.equal(packageJson.scripts['migrate:managed-chat'], undefined);
});

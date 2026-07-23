const test = require('node:test');
const assert = require('node:assert/strict');
const schemaContract = require('../src/schema-contract');
const {
  cloneProductionSchemaMetadata,
  createSchemaMetadataDatabase,
} = require('./helpers/schema-metadata-harness');

const { verifyPreservedCoreSchema, verifySchema } = schemaContract;

function row(metadata, tableName, columnName) {
  const match = metadata.columns.find((candidate) => (
    (candidate.table_name ?? candidate.TABLE_NAME) === tableName
    && (candidate.column_name ?? candidate.COLUMN_NAME) === columnName
  ));
  assert.ok(match, `${tableName}.${columnName} must exist in the fixture`);
  return match;
}

function indexRows(metadata, tableName, indexName) {
  return metadata.indexes.filter((candidate) => (
    candidate.table_name === tableName && candidate.index_name === indexName
  ));
}

function foreignKeyRows(metadata, tableName, constraintName) {
  return metadata.foreignKeys.filter((candidate) => (
    candidate.table_name === tableName
    && candidate.constraint_name === constraintName
  ));
}

async function verifyMetadata(metadata) {
  const { database } = createSchemaMetadataDatabase(metadata);
  return verifySchema(database);
}

async function verifyPreservedMetadata(metadata) {
  const { database } = createSchemaMetadataDatabase(metadata);
  return verifyPreservedCoreSchema(database);
}

async function expectInvariant(mutator, pattern) {
  const metadata = cloneProductionSchemaMetadata();
  mutator(metadata);
  await assert.rejects(verifyMetadata(metadata), pattern);
}

test('exports only the complete and preserved-core production verifiers', () => {
  assert.deepEqual(Object.keys(schemaContract).sort(), [
    'verifyPreservedCoreSchema',
    'verifySchema',
  ]);
});

test('literal fixture is independent across clones', () => {
  const first = cloneProductionSchemaMetadata();
  const second = cloneProductionSchemaMetadata();
  first.tables[0].engine = 'Changed';
  assert.equal(second.tables[0].engine, 'InnoDB');
});

test('accepts lower-case driver keys using four read-only metadata queries', async () => {
  const metadata = cloneProductionSchemaMetadata();
  const { database, queries } = createSchemaMetadataDatabase(metadata);

  assert.equal(await verifySchema(database), true);
  assert.equal(queries.length, 4);
  assert.equal(queries.every((sql) => /^\s*SELECT\b/i.test(sql)), true);
  assert.equal(queries.some((sql) => /information_schema\.tables/i.test(sql)), true);
  assert.equal(queries.some((sql) => /information_schema\.columns/i.test(sql)), true);
  assert.equal(queries.some((sql) => /information_schema\.statistics/i.test(sql)), true);
  assert.equal(
    queries.some((sql) => /information_schema\.key_column_usage/i.test(sql)),
    true,
  );
});

test('accepts upper-case driver keys', async () => {
  assert.equal(
    await verifyMetadata(cloneProductionSchemaMetadata({ keyCase: 'upper' })),
    true,
  );
});

test('rejects a missing or non-base application table', async () => {
  await expectInvariant((metadata) => {
    metadata.tables = metadata.tables.filter(({ table_name }) => table_name !== 'messages');
  }, /messages table must exist/);

  await expectInvariant((metadata) => {
    metadata.tables.find(({ table_name }) => table_name === 'messages').table_type = 'VIEW';
  }, /messages table type must be BASE TABLE/);
});

test('rejects the wrong storage engine or collation', async () => {
  await expectInvariant((metadata) => {
    metadata.tables.find(({ table_name }) => table_name === 'users').engine = 'MyISAM';
  }, /users engine must be InnoDB/);

  await expectInvariant((metadata) => {
    metadata.tables.find(({ table_name }) => table_name === 'portfolios')
      .table_collation = 'utf8mb4_general_ci';
  }, /portfolios collation must be utf8mb4_0900_ai_ci/);
});

test('rejects a missing field and a retired direct-message field', async () => {
  await expectInvariant((metadata) => {
    metadata.columns = metadata.columns.filter((candidate) => (
      !(candidate.table_name === 'messages' && candidate.column_name === 'content')
    ));
  }, /messages\.content must exist/);

  for (const retired of ['receiver_id', 'portfolio_id', 'read_at']) {
    await expectInvariant((metadata) => {
      metadata.columns.push({
        table_name: 'messages',
        column_name: retired,
        ordinal_position: metadata.columns.length + 1,
        column_type: 'int',
        is_nullable: 'YES',
        column_default: null,
        extra: '',
        generation_expression: '',
      });
    }, new RegExp(`messages\\.${retired} must not exist`));
  }
});

test('rejects wrong column type, nullability, default, and physical order', async () => {
  await expectInvariant((metadata) => {
    row(metadata, 'portfolios', 'funding_goal').column_type = 'decimal(14,2)';
  }, /portfolios\.funding_goal type must be decimal\(15,2\)/);

  await expectInvariant((metadata) => {
    row(metadata, 'users', 'created_at').is_nullable = 'NO';
  }, /users\.created_at nullability must be YES/);

  await expectInvariant((metadata) => {
    row(metadata, 'notifications', 'created_at').column_default = null;
  }, /notifications\.created_at default must be CURRENT_TIMESTAMP/);

  await expectInvariant((metadata) => {
    row(metadata, 'portfolios', 'readiness_score').ordinal_position = 11;
  }, /portfolios\.readiness_score ordinal position must be 12/);
});

test('rejects auto-increment, timestamp-extra, and unsigned cursor drift', async () => {
  await expectInvariant((metadata) => {
    row(metadata, 'users', 'id').extra = '';
  }, /users\.id extra must include auto_increment/);

  await expectInvariant((metadata) => {
    row(metadata, 'users', 'updated_at').extra = 'DEFAULT_GENERATED';
  }, /users\.updated_at extra must include on update CURRENT_TIMESTAMP/);

  await expectInvariant((metadata) => {
    row(metadata, 'conversation_members', 'last_read_message_id').column_type = 'bigint';
  }, /conversation_members\.last_read_message_id type must be bigint unsigned/);
});

test('rejects enum value or order drift', async () => {
  await expectInvariant((metadata) => {
    row(metadata, 'users', 'role').column_type =
      "enum('business_owner','investor','admin','relationship_manager')";
  }, /users\.role type must be enum\('business_owner','investor','relationship_manager','admin'\)/);

  await expectInvariant((metadata) => {
    row(metadata, 'portfolios', 'mvp_status').column_type =
      "enum('Idea','Prototype','Beta','Launched','Retired')";
  }, /portfolios\.mvp_status type must be enum\('Idea','Prototype','Beta','Launched'\)/);
});

test('rejects generated-expression semantic drift', async () => {
  await expectInvariant((metadata) => {
    row(metadata, 'conversation_members', 'singleton_role').generation_expression =
      "(case when (`member_role` in (_utf8mb4'relationship_manager',_utf8mb4'investor')) then `member_role` else NULL end)";
  }, /conversation_members\.singleton_role generation expression changed/);

  await expectInvariant((metadata) => {
    row(metadata, 'conversation_members', 'singleton_role').generation_expression =
      "(case when (`member_role` in (_utf8mb4'RELATIONSHIP_MANAGER',_utf8mb4'business_owner')) then `member_role` else NULL end)";
  }, /conversation_members\.singleton_role generation expression changed/);
});

test('accepts equivalent metadata representations', async () => {
  const metadata = cloneProductionSchemaMetadata();
  row(metadata, 'portfolios', 'readiness_score').column_default = 0;
  row(metadata, 'users', 'created_at').column_default = 'current_timestamp()';
  row(metadata, 'users', 'updated_at').extra =
    'ON UPDATE current_timestamp DEFAULT_GENERATED';
  row(metadata, 'conversation_members', 'singleton_role').extra =
    'generated stored';
  row(metadata, 'conversation_members', 'singleton_role').generation_expression =
    "(( CASE WHEN ( member_role IN ( _utf8mb4'relationship_manager' , _utf8mb4'business_owner' ) ) THEN member_role ELSE NULL END ))";

  assert.equal(await verifyMetadata(metadata), true);
});

test('requires every primary and business-unique index structurally', async () => {
  await expectInvariant((metadata) => {
    metadata.indexes = metadata.indexes.filter((candidate) => (
      !(candidate.table_name === 'users' && candidate.index_name === 'email')
    ));
  }, /users unique index \(email\) is required/);

  await expectInvariant((metadata) => {
    metadata.indexes = metadata.indexes.filter((candidate) => (
      !(
        candidate.table_name === 'investor_interests'
        && candidate.index_name === 'unique_interest'
      )
    ));
  }, /investor_interests unique index \(investor_id,portfolio_id\) is required/);

  await expectInvariant((metadata) => {
    const primary = indexRows(metadata, 'conversation_members', 'PRIMARY');
    [primary[0].column_name, primary[1].column_name] =
      [primary[1].column_name, primary[0].column_name];
  }, /conversation_members PRIMARY must be \(conversation_id,user_id\)/);

  await expectInvariant((metadata) => {
    const unique = indexRows(
      metadata,
      'conversation_members',
      'unique_conversation_singleton',
    );
    [unique[0].column_name, unique[1].column_name] =
      [unique[1].column_name, unique[0].column_name];
  }, /conversation_members unique index \(conversation_id,singleton_role\) is required/);
});

test('matches non-unique access indexes by a visible left prefix', async () => {
  const renamed = cloneProductionSchemaMetadata();
  for (const candidate of indexRows(
    renamed,
    'messages',
    'idx_messages_conversation_id',
  )) {
    candidate.index_name = 'renamed_messages_access';
  }
  renamed.indexes.push({
    table_name: 'messages',
    index_name: 'renamed_messages_access',
    non_unique: 1,
    seq_in_index: 3,
    column_name: 'created_at',
    index_type: 'BTREE',
    is_visible: 'YES',
  });
  assert.equal(await verifyMetadata(renamed), true);

  await expectInvariant((metadata) => {
    for (const candidate of indexRows(
      metadata,
      'messages',
      'idx_messages_conversation_id',
    )) {
      candidate.is_visible = 'NO';
    }
  }, /messages access index \(conversation_id,id\) is required/);

  await expectInvariant((metadata) => {
    for (const candidate of indexRows(
      metadata,
      'messages',
      'idx_messages_conversation_id',
    )) {
      candidate.index_type = 'HASH';
    }
  }, /messages access index \(conversation_id,id\) is required/);

  await expectInvariant((metadata) => {
    const access = indexRows(
      metadata,
      'conversation_members',
      'idx_members_user_status',
    );
    [access[0].column_name, access[1].column_name] =
      [access[1].column_name, access[0].column_name];
  }, /conversation_members access index \(user_id,membership_status\) is required/);
});

test('allows extra non-conflicting and automatic foreign-key support indexes', async () => {
  const metadata = cloneProductionSchemaMetadata();
  metadata.indexes.push(
    {
      table_name: 'portfolios',
      index_name: 'idx_extra_status',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'status',
      index_type: 'BTREE',
      is_visible: 'YES',
    },
    {
      table_name: 'notifications',
      index_name: 'automatic_fk_support',
      non_unique: 1,
      seq_in_index: 1,
      column_name: 'related_user_id',
      index_type: 'BTREE',
      is_visible: 'YES',
    },
  );
  assert.equal(await verifyMetadata(metadata), true);
});

test('matches foreign keys structurally rather than by constraint name', async () => {
  const metadata = cloneProductionSchemaMetadata();
  for (const candidate of foreignKeyRows(
    metadata,
    'messages',
    'fk_messages_member',
  )) {
    candidate.constraint_name = 'renamed_message_membership';
  }
  assert.equal(await verifyMetadata(metadata), true);
});

test('rejects foreign-key column order, target, and referential-action drift', async () => {
  await expectInvariant((metadata) => {
    const members = foreignKeyRows(metadata, 'messages', 'fk_messages_member');
    [members[0].column_name, members[1].column_name] =
      [members[1].column_name, members[0].column_name];
  }, /messages foreign key \(conversation_id,sender_id\) -> conversation_members\(conversation_id,user_id\)/);

  await expectInvariant((metadata) => {
    const members = foreignKeyRows(metadata, 'messages', 'fk_messages_member');
    [members[0].referenced_column_name, members[1].referenced_column_name] =
      [members[1].referenced_column_name, members[0].referenced_column_name];
  }, /messages foreign key \(conversation_id,sender_id\) -> conversation_members\(conversation_id,user_id\)/);

  await expectInvariant((metadata) => {
    foreignKeyRows(metadata, 'notifications', 'fk_notifications_message')[0]
      .referenced_table_name = 'users';
  }, /notifications foreign key \(related_message_id\) -> messages\(id\)/);

  await expectInvariant((metadata) => {
    foreignKeyRows(metadata, 'conversations', 'fk_conversations_portfolio')[0]
      .delete_rule = 'CASCADE';
  }, /conversations foreign key \(portfolio_id\).*ON DELETE SET NULL/);

  await expectInvariant((metadata) => {
    foreignKeyRows(metadata, 'conversations', 'fk_conversations_manager')[0]
      .update_rule = 'CASCADE';
  }, /conversations foreign key \(relationship_manager_id\).*ON UPDATE NO ACTION/);
});

test('preserves the accepted audit portfolio cascade', async () => {
  await expectInvariant((metadata) => {
    foreignKeyRows(metadata, 'audit_logs', 'audit_logs_ibfk_2')[0]
      .delete_rule = 'RESTRICT';
  }, /audit_logs foreign key \(portfolio_id\).*ON DELETE CASCADE/);
});

function legacyManagedChatMetadata() {
  const metadata = cloneProductionSchemaMetadata();
  const chatTables = new Set([
    'conversations',
    'conversation_members',
    'messages',
  ]);
  metadata.tables = metadata.tables.filter(({ table_name }) => (
    !chatTables.has(table_name)
  ));
  metadata.columns = metadata.columns.filter(({ table_name, column_name }) => (
    !chatTables.has(table_name)
    && !(
      table_name === 'notifications'
      && ['related_conversation_id', 'related_message_id'].includes(column_name)
    )
  ));
  metadata.indexes = metadata.indexes.filter(({ table_name, column_name }) => (
    !chatTables.has(table_name)
    && !(
      table_name === 'notifications'
      && ['related_conversation_id', 'related_message_id'].includes(column_name)
    )
  ));
  metadata.foreignKeys = metadata.foreignKeys.filter((candidate) => (
    !chatTables.has(candidate.table_name)
    && !(
      candidate.table_name === 'notifications'
      && ['related_conversation_id', 'related_message_id']
        .includes(candidate.column_name)
    )
  ));

  row(metadata, 'users', 'role').column_type =
    "enum('business_owner','investor','admin')";
  row(metadata, 'notifications', 'type').column_type =
    "enum('new_message','new_interest','portfolio_approved','portfolio_rejected','portfolio_needs_changes','portfolio_submitted')";
  metadata.columns
    .filter(({ table_name }) => table_name === 'notifications')
    .sort((left, right) => left.ordinal_position - right.ordinal_position)
    .forEach((candidate, index) => {
      candidate.ordinal_position = index + 1;
    });
  return metadata;
}

test('preserved-core verifier accepts exact legacy and target enum shapes', async () => {
  assert.equal(
    await verifyPreservedMetadata(legacyManagedChatMetadata()),
    true,
  );
  assert.equal(
    await verifyPreservedMetadata(cloneProductionSchemaMetadata()),
    true,
  );
});

test('preserved-core verifier rejects reordered or unknown enum values', async () => {
  const reordered = legacyManagedChatMetadata();
  row(reordered, 'users', 'role').column_type =
    "enum('investor','business_owner','admin')";
  await assert.rejects(
    verifyPreservedMetadata(reordered),
    /users\.role must use an allowed migration enum shape/,
  );

  const unknown = legacyManagedChatMetadata();
  row(unknown, 'notifications', 'type').column_type =
    "enum('new_message','new_interest','portfolio_approved','portfolio_rejected','portfolio_needs_changes','portfolio_submitted','unknown')";
  await assert.rejects(
    verifyPreservedMetadata(unknown),
    /notifications\.type must use an allowed migration enum shape/,
  );
});

test('preserved-core verifier rejects missing core columns and uniqueness', async () => {
  const missingColumn = legacyManagedChatMetadata();
  missingColumn.columns = missingColumn.columns.filter((candidate) => (
    !(candidate.table_name === 'portfolios' && candidate.column_name === 'funding_goal')
  ));
  await assert.rejects(
    verifyPreservedMetadata(missingColumn),
    /portfolios\.funding_goal must exist/,
  );

  const missingEmail = legacyManagedChatMetadata();
  missingEmail.indexes = missingEmail.indexes.filter((candidate) => (
    !(candidate.table_name === 'users' && candidate.index_name === 'email')
  ));
  await assert.rejects(
    verifyPreservedMetadata(missingEmail),
    /users unique index \(email\) is required/,
  );

  const missingInterest = legacyManagedChatMetadata();
  missingInterest.indexes = missingInterest.indexes.filter((candidate) => (
    !(
      candidate.table_name === 'investor_interests'
      && candidate.index_name === 'unique_interest'
    )
  ));
  await assert.rejects(
    verifyPreservedMetadata(missingInterest),
    /investor_interests unique index \(investor_id,portfolio_id\) is required/,
  );
});

test('preserved-core verifier rejects core foreign-key drift', async () => {
  const auditDrift = legacyManagedChatMetadata();
  foreignKeyRows(auditDrift, 'audit_logs', 'audit_logs_ibfk_2')[0]
    .delete_rule = 'RESTRICT';
  await assert.rejects(
    verifyPreservedMetadata(auditDrift),
    /audit_logs foreign key \(portfolio_id\).*ON DELETE CASCADE/,
  );

  const notificationDrift = legacyManagedChatMetadata();
  foreignKeyRows(notificationDrift, 'notifications', 'notifications_ibfk_2')[0]
    .referenced_table_name = 'users';
  await assert.rejects(
    verifyPreservedMetadata(notificationDrift),
    /notifications foreign key \(related_portfolio_id\) -> portfolios\(id\)/,
  );
});

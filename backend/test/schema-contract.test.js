const test = require('node:test');
const assert = require('node:assert/strict');
const schemaContract = require('../src/schema-contract');
const {
  cloneProductionSchemaMetadata,
  createSchemaMetadataDatabase,
} = require('./helpers/schema-metadata-harness');

const { verifySchema } = schemaContract;

function row(metadata, tableName, columnName) {
  const match = metadata.columns.find((candidate) => (
    (candidate.table_name ?? candidate.TABLE_NAME) === tableName
    && (candidate.column_name ?? candidate.COLUMN_NAME) === columnName
  ));
  assert.ok(match, `${tableName}.${columnName} must exist in the fixture`);
  return match;
}

async function verifyMetadata(metadata) {
  const { database } = createSchemaMetadataDatabase(metadata);
  return verifySchema(database);
}

async function expectInvariant(mutator, pattern) {
  const metadata = cloneProductionSchemaMetadata();
  mutator(metadata);
  await assert.rejects(verifyMetadata(metadata), pattern);
}

test('exports only the production verifier in this phase', () => {
  assert.deepEqual(Object.keys(schemaContract).sort(), ['verifySchema']);
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

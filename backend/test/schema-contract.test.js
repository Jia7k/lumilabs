const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_COLUMNS,
  REQUIRED_ENUMS,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_INDEXES,
  verifySchema,
} = require('../src/schema-contract');

function completeMetadata() {
  const columns = Object.entries(REQUIRED_COLUMNS).flatMap(([table, names]) => (
    names.map((column) => ({
      TABLE_NAME: table,
      COLUMN_NAME: column,
      IS_NULLABLE: ['archived_reason', 'portfolio_id'].includes(column) ? 'YES' : 'NO',
      COLUMN_TYPE: REQUIRED_ENUMS[`${table}.${column}`]
        ? `enum(${REQUIRED_ENUMS[`${table}.${column}`].map((value) => `'${value}'`).join(',')})`
        : 'int',
      EXTRA: column === 'singleton_role' ? 'STORED GENERATED' : '',
    }))
  ));

  const indexes = Object.entries(REQUIRED_INDEXES).flatMap(([key, definition]) => {
    const [table, indexName] = key.split('.');
    return definition.columns.map((column, index) => ({
      TABLE_NAME: table,
      INDEX_NAME: indexName,
      NON_UNIQUE: definition.unique ? 0 : 1,
      SEQ_IN_INDEX: index + 1,
      COLUMN_NAME: column,
    }));
  });

  const foreignKeys = Object.entries(REQUIRED_FOREIGN_KEYS).flatMap(([key, definition]) => {
    const [table, constraintName] = key.split('.');
    return definition.columns.map((column, index) => ({
      TABLE_NAME: table,
      CONSTRAINT_NAME: constraintName,
      COLUMN_NAME: column,
      REFERENCED_TABLE_NAME: definition.referencedTable,
      REFERENCED_COLUMN_NAME: definition.referencedColumns[index],
      ORDINAL_POSITION: index + 1,
    }));
  });

  return { columns, indexes, foreignKeys };
}

test('accepts MySQL information-schema column key casing', async () => {
  const metadata = completeMetadata();
  const results = [metadata.columns, metadata.indexes, metadata.foreignKeys];
  const database = {
    async query() {
      return [results.shift(), []];
    },
  };

  assert.equal(await verifySchema(database), true);
});

test('reports each missing schema field precisely', async () => {
  const metadata = completeMetadata();
  metadata.columns = metadata.columns.filter((row) => (
    !(row.TABLE_NAME === 'messages' && row.COLUMN_NAME === 'content')
  ));
  const results = [metadata.columns, metadata.indexes, metadata.foreignKeys];
  const database = { query: async () => [results.shift(), []] };

  await assert.rejects(
    verifySchema(database),
    /Missing schema fields: messages\.content/,
  );
});

test('rejects a nullable message conversation and missing notification enum value', async () => {
  const metadata = completeMetadata();
  const conversation = metadata.columns.find((row) => (
    row.TABLE_NAME === 'messages' && row.COLUMN_NAME === 'conversation_id'
  ));
  conversation.IS_NULLABLE = 'YES';
  const notificationType = metadata.columns.find((row) => (
    row.TABLE_NAME === 'notifications' && row.COLUMN_NAME === 'type'
  ));
  notificationType.COLUMN_TYPE = notificationType.COLUMN_TYPE.replace(
    ",'conversation_archived'",
    '',
  );
  const results = [metadata.columns, metadata.indexes, metadata.foreignKeys];

  await assert.rejects(
    verifySchema({ query: async () => [results.shift(), []] }),
    /messages\.conversation_id must be NOT NULL[\s\S]*notifications\.type missing enum value conversation_archived/,
  );
});

test('rejects missing managed-room uniqueness and message-member foreign key', async () => {
  const metadata = completeMetadata();
  metadata.indexes = metadata.indexes.filter((row) => (
    row.INDEX_NAME !== 'unique_conversation_portfolio'
  ));
  metadata.foreignKeys = metadata.foreignKeys.filter((row) => (
    row.CONSTRAINT_NAME !== 'fk_messages_member'
  ));
  const results = [metadata.columns, metadata.indexes, metadata.foreignKeys];

  await assert.rejects(
    verifySchema({ query: async () => [results.shift(), []] }),
    /Missing schema invariants: conversations\.unique_conversation_portfolio[\s\S]*messages\.fk_messages_member/,
  );
});

test('rejects extra enum values instead of accepting schema drift', async () => {
  const metadata = completeMetadata();
  const role = metadata.columns.find((row) => (
    row.TABLE_NAME === 'users' && row.COLUMN_NAME === 'role'
  ));
  role.COLUMN_TYPE = role.COLUMN_TYPE.replace("'admin')", "'admin','super_admin')");
  const results = [metadata.columns, metadata.indexes, metadata.foreignKeys];

  await assert.rejects(
    verifySchema({ query: async () => [results.shift(), []] }),
    /users\.role enum values must exactly match/,
  );
});

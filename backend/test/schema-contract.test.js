const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REQUIRED_COLUMNS,
  verifySchema,
} = require('../src/schema-contract');

function rowsForRequiredSchema() {
  return Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) => (
    columns.map((column) => ({
      TABLE_NAME: table,
      COLUMN_NAME: column,
    }))
  ));
}

test('accepts MySQL information-schema column key casing', async () => {
  const database = {
    async query(sql) {
      assert.match(sql, /information_schema\.columns/);
      return [rowsForRequiredSchema(), []];
    },
  };

  assert.equal(await verifySchema(database), true);
});

test('reports each missing schema field precisely', async () => {
  const rows = rowsForRequiredSchema().filter((row) => (
    !(row.TABLE_NAME === 'messages' && row.COLUMN_NAME === 'content')
  ));
  const database = { query: async () => [rows, []] };

  await assert.rejects(
    verifySchema(database),
    /Missing schema fields: messages\.content/,
  );
});

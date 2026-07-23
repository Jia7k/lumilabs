const productionSchemaMetadata = require('../fixtures/production-schema-metadata.json');

function cloneProductionSchemaMetadata({ keyCase = 'lower' } = {}) {
  const clone = JSON.parse(JSON.stringify(productionSchemaMetadata));
  if (keyCase === 'lower') return clone;
  if (keyCase !== 'upper') {
    throw new Error(`Unsupported metadata key case: ${keyCase}`);
  }

  for (const rows of Object.values(clone)) {
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        delete row[key];
        row[key.toUpperCase()] = value;
      }
    }
  }
  return clone;
}

function createSchemaMetadataDatabase(metadata) {
  const queries = [];
  const database = {
    async query(sql) {
      const source = String(sql);
      queries.push(source);
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
      throw new Error(`Unexpected schema metadata query: ${source}`);
    },
  };
  return { database, queries };
}

module.exports = {
  cloneProductionSchemaMetadata,
  createSchemaMetadataDatabase,
};

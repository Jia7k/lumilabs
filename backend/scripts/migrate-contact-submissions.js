const {
  verifyPreservedCoreSchema,
  verifySchema,
} = require('../src/schema-contract');

const CREATE_CONTACT_SUBMISSIONS = `
  CREATE TABLE IF NOT EXISTS contact_submissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    message TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_contact_submissions_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`;

async function tableExists(connection) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'contact_submissions'`,
  );
  return Number(rows[0]?.count || 0) === 1;
}

async function migrateContactSubmissions(connection, {
  verifyBefore = verifyPreservedCoreSchema,
  verifyAfter = verifySchema,
} = {}) {
  await verifyBefore(connection);
  const existed = await tableExists(connection);
  await connection.query(CREATE_CONTACT_SUBMISSIONS);
  await verifyAfter(connection);
  return {
    status: 'ready',
    changed: existed ? [] : ['contact_submissions'],
  };
}

module.exports = {
  CREATE_CONTACT_SUBMISSIONS,
  migrateContactSubmissions,
};

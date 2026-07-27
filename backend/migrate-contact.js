require('dotenv').config();

const mysql = require('mysql2/promise');
const {
  openMigrationTunnel,
  releaseMigrationResources,
  requireEnvironment,
} = require('./migrate');
const {
  migrateContactSubmissions,
} = require('./scripts/migrate-contact-submissions');

async function main(environment = process.env) {
  requireEnvironment(environment);
  let tunnel;
  let connection;
  try {
    tunnel = await openMigrationTunnel(environment);
    connection = await mysql.createConnection({
      host: tunnel ? '127.0.0.1' : (environment.DB_HOST || '127.0.0.1'),
      port: tunnel ? tunnel.localPort : Number(environment.DB_PORT || 3306),
      user: environment.DB_USER,
      password: environment.DB_PASSWORD,
      database: environment.DB_NAME,
    });
    const result = await migrateContactSubmissions(connection);
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await releaseMigrationResources({ connection, tunnel });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Contact migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };

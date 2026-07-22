require('dotenv').config();

const mysql = require('mysql2/promise');
const { createTunnel } = require('tunnel-ssh');
const { migrateManagedChat } = require('./scripts/migrate-managed-chat');

function requireEnvironment(environment) {
  const names = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  if (environment.SSH_HOST) {
    names.push('SSH_USER', 'SSH_PASSWORD');
  }
  const missing = names.filter((name) => !String(environment[name] || '').trim());
  if (missing.length) {
    throw new Error(`Missing migration environment variables: ${missing.join(', ')}`);
  }
}

async function openMigrationTunnel(environment) {
  if (!environment.SSH_HOST) return null;
  const localPort = Number(environment.DB_TUNNEL_PORT || 3307);
  const [server] = await createTunnel(
    { autoClose: true },
    { port: localPort },
    {
      host: environment.SSH_HOST,
      port: Number(environment.SSH_PORT || 22),
      username: environment.SSH_USER,
      password: environment.SSH_PASSWORD,
      tryKeyboard: true,
    },
    {
      srcAddr: '127.0.0.1',
      srcPort: localPort,
      dstAddr: environment.DB_REMOTE_HOST || '127.0.0.1',
      dstPort: Number(environment.DB_REMOTE_PORT || 3306),
    },
  );
  return { server, localPort };
}

async function closeTunnel(tunnel) {
  if (!tunnel?.server) return;
  await new Promise((resolve, reject) => {
    tunnel.server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
  });
}

async function releaseMigrationResources({ connection, tunnel }) {
  const errors = [];
  if (connection) {
    try {
      await connection.end();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await closeTunnel(tunnel);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to release migration resources');
  }
}

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
    const result = await migrateManagedChat(connection, environment);
    console.log(JSON.stringify({ status: 'managed chat migration complete', ...result }));
    return result;
  } finally {
    await releaseMigrationResources({ connection, tunnel });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  openMigrationTunnel,
  releaseMigrationResources,
  requireEnvironment,
};

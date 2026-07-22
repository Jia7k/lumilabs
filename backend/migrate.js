require('dotenv').config();
const { createTunnel } = require('tunnel-ssh');
const mysql = require('mysql2/promise');

async function migrate() {
  const tunnelPort = parseInt(process.env.DB_TUNNEL_PORT || '3307');

  console.log('Setting up SSH tunnel...');
  const [server] = await createTunnel(
    { autoClose: true },
    { port: tunnelPort },
    {
      host: process.env.SSH_HOST,
      port: parseInt(process.env.SSH_PORT || '22'),
      username: process.env.SSH_USER,
      password: process.env.SSH_PASSWORD,
      tryKeyboard: true,
    },
    { srcAddr: '127.0.0.1', srcPort: tunnelPort, dstAddr: '127.0.0.1', dstPort: 3306 }
  );
  console.log('Tunnel up. Connecting to MySQL...');

  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: tunnelPort,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  console.log('Running migration...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS investor_interests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      investor_id INT NOT NULL,
      portfolio_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_interest (investor_id, portfolio_id),
      FOREIGN KEY (investor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
    );

    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reason TEXT;
  `);

  console.log('Migration complete!');
  await conn.end();
  server.close();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});

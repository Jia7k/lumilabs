require('dotenv').config();

async function main() {
  // Set up SSH tunnel if SSH_HOST is configured
  if (process.env.SSH_HOST) {
    const { Client } = require('ssh2');
    const net = require('net');
    const tunnelPort = parseInt(process.env.DB_TUNNEL_PORT || '3307');

    console.log(`Connecting SSH tunnel to ${process.env.SSH_HOST}...`);
    await new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        const server = net.createServer((socket) => {
          conn.forwardOut('127.0.0.1', tunnelPort, '127.0.0.1', 3306, (err, stream) => {
            if (err) { socket.destroy(); return; }
            socket.pipe(stream).pipe(socket);
          });
        });
        server.listen(tunnelPort, '127.0.0.1', () => {
          process.env.DB_HOST = '127.0.0.1';
          process.env.DB_PORT = String(tunnelPort);
          console.log(`SSH tunnel established → localhost:${tunnelPort}`);
          resolve();
        });
      });

      conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
        finish([process.env.SSH_PASSWORD]);
      });

      conn.on('error', (err) => {
        console.error('SSH tunnel failed:', err.message);
        reject(err);
      });

      conn.connect({
        host: process.env.SSH_HOST,
        port: parseInt(process.env.SSH_PORT || '22'),
        username: process.env.SSH_USER,
        password: process.env.SSH_PASSWORD,
        tryKeyboard: true,
        readyTimeout: 30000,
      });
    }).catch(() => process.exit(1));
  }

  // Load routes AFTER tunnel is up so db.js picks up the correct DB_HOST/DB_PORT
  const express = require('express');
  const cors = require('cors');
  const multer = require('multer');

  const authRoutes          = require('./src/routes/auth');
  const portfolioRoutes     = require('./src/routes/portfolios');
  const interestRoutes      = require('./src/routes/interests');
  const messageRoutes       = require('./src/routes/messages');
  const adminRoutes         = require('./src/routes/admin');
  const notificationRoutes  = require('./src/routes/notifications');
  const recommendationRoutes= require('./src/routes/recommendations');
  const dashboardRoutes     = require('./src/routes/dashboard');

  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
  app.use(express.json());

  app.use('/api/auth',            authRoutes);
  app.use('/api/portfolios',      portfolioRoutes);
  app.use('/api/interests',       interestRoutes);
  app.use('/api/messages',        messageRoutes);
  app.use('/api/admin',           adminRoutes);
  app.use('/api/notifications',   notificationRoutes);
  app.use('/api/recommendations', recommendationRoutes);
  app.use('/api/dashboard',       dashboardRoutes);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: 'Invalid document upload' });
    }
    return next(error);
  });
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Lumi5 Labs API running on port ${PORT}`));
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

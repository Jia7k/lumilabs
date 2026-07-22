require('dotenv').config();

const { verifySchema } = require('./src/schema-contract');

function validateEnvironment(environment = process.env) {
  const required = ['JWT_SECRET', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  if (environment.SSH_HOST) required.push('SSH_USER', 'SSH_PASSWORD');

  const missing = required.filter(
    (name) => typeof environment[name] !== 'string' || !environment[name].trim(),
  );
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return true;
}

async function openSshTunnel(environment = process.env) {
  if (!environment.SSH_HOST) return null;

  const { Client } = require('ssh2');
  const net = require('net');
  const localPort = Number(environment.DB_TUNNEL_PORT || 3307);
  const remoteHost = environment.DB_REMOTE_HOST || '127.0.0.1';
  const remotePort = Number(environment.DB_REMOTE_PORT || 3306);
  const connection = new Client();

  const tunnel = await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      connection.end();
      reject(error);
    };

    connection.once('ready', () => {
      const server = net.createServer((socket) => {
        connection.forwardOut(
          socket.localAddress || '127.0.0.1',
          socket.localPort || 0,
          remoteHost,
          remotePort,
          (error, stream) => {
            if (error) {
              socket.destroy(error);
              return;
            }
            socket.pipe(stream).pipe(socket);
          },
        );
      });

      server.once('error', fail);
      server.listen(localPort, '127.0.0.1', () => {
        if (settled) return;
        settled = true;
        environment.DB_HOST = '127.0.0.1';
        environment.DB_PORT = String(localPort);
        resolve({
          connection,
          server,
          close: () => new Promise((closeResolve) => {
            server.close(() => {
              connection.end();
              closeResolve();
            });
          }),
        });
      });
    });

    connection.once('keyboard-interactive', (
      name,
      instructions,
      language,
      prompts,
      finish,
    ) => finish(prompts.map(() => environment.SSH_PASSWORD)));
    connection.once('error', fail);
    connection.connect({
      host: environment.SSH_HOST,
      port: Number(environment.SSH_PORT || 22),
      username: environment.SSH_USER,
      password: environment.SSH_PASSWORD,
      tryKeyboard: true,
      readyTimeout: 30000,
    });
  });

  return tunnel;
}

function createApp(options = {}) {
  const express = require('express');
  const multer = require('multer');
  const database = options.database || require('./src/config/db');
  const checkSchema = options.verifySchema || verifySchema;

  const authRoutes = require('./src/routes/auth');
  const portfolioRoutes = require('./src/routes/portfolios');
  const interestRoutes = require('./src/routes/interests');
  const messageRoutes = require('./src/routes/messages');
  const adminRoutes = require('./src/routes/admin');
  const notificationRoutes = require('./src/routes/notifications');
  const recommendationRoutes = require('./src/routes/recommendations');
  const dashboardRoutes = require('./src/routes/dashboard');

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', async (req, res) => {
    try {
      await database.query('SELECT 1');
      await checkSchema(database);
      return res.json({ status: 'ready' });
    } catch (error) {
      console.error('Readiness check failed:', error.message);
      return res.status(503).json({ status: 'not ready' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/portfolios', portfolioRoutes);
  app.use('/api/interests', interestRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/recommendations', recommendationRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: 'Invalid document upload' });
    }
    return next(error);
  });
  app.use((error, req, res, next) => {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

async function main() {
  validateEnvironment();
  const tunnel = await openSshTunnel();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3100);
  const app = createApp();

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, host, () => resolve(listener));
    listener.once('error', reject);
  }).catch(async (error) => {
    if (tunnel) await tunnel.close();
    throw error;
  });

  console.log(`LumiLabs API listening at http://${host}:${port}`);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await new Promise((resolve) => server.close(resolve));
    if (tunnel) await tunnel.close();
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);

  return { app, server, tunnel, close };
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal startup error:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  main,
  openSshTunnel,
  validateEnvironment,
};

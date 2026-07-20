require('dotenv').config();
const express = require('express');
const messageRoutes = require('./src/routes/messages');

function createMessagingApp() {
  const app = express();

  app.use(express.json());
  app.get('/api/messages/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/messages', messageRoutes);
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.MESSAGES_PORT) || 3001;
  const host = '127.0.0.1';

  createMessagingApp().listen(port, host, () => {
    console.log(`LumiLabs messaging API running at http://${host}:${port}`);
  });
}

module.exports = { createMessagingApp };

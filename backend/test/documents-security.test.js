const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const { fileFilter } = require('../src/middleware/upload');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'backend/src/routes/portfolios.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const apiClient = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');
const moderatorClient = fs.readFileSync(path.join(root, 'js/moderatordashboard.js'), 'utf8');

test('an allowed MIME with an html extension is rejected', async () => {
  const error = await new Promise((resolve) => {
    fileFilter(
      null,
      { mimetype: 'application/pdf', originalname: 'payload.html' },
      (value) => resolve(value),
    );
  });
  assert.ok(error instanceof multer.MulterError);
});

test('the owned portfolio is checked before multer writes a file', () => {
  assert.match(route, /loadOwnedEditablePortfolio,\s*upload\.array\('documents', 5\)/);
});

test('draft documents are unavailable to unrelated investors', () => {
  assert.match(route, /req\.user\.role === 'investor' && doc\.status === 'approved'/);
  assert.match(route, /return res\.status\(403\)\.json\(\{ error: 'Forbidden' \}\)/);
});

test('download responses use attachment disposition', () => {
  assert.match(route, /documents\/:docId\/download/);
  assert.match(route, /res\.download\(absolute, doc\.file_name\)/);
  assert.doesNotMatch(server, /express\.static\(path\.join\(__dirname, 'uploads'\)\)/);
});

test('multer size and type failures return 4xx JSON', () => {
  assert.match(server, /error instanceof multer\.MulterError/);
  assert.match(server, /error\.code === 'LIMIT_FILE_SIZE' \? 413 : 400/);
});

test('browser document downloads are intercepted and sent with authentication', () => {
  assert.match(apiClient, /downloadDocument:\s*downloadDocument/);
  assert.match(apiClient, /fetch\(downloadUrl,\s*\{[\s\S]*Authorization/);
  assert.match(moderatorClient, /data-document-download/);
  assert.match(moderatorClient, /preventDefault\(\)/);
});

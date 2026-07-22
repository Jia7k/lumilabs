const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const route = fs.readFileSync(path.join(root, 'backend/src/routes/portfolios.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'js/createportfolio.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'createportfolio.html'), 'utf8');

test('pending portfolios cannot be updated or receive document changes', () => {
  assert.match(route, /portfolio\.status === 'pending'/);
  assert.match(route, /pending portfolio cannot be edited|A pending portfolio cannot be edited/i);
  assert.match(route, /loadOwnedEditablePortfolio/);
});

test('editing approved or rejected content resets review state', () => {
  assert.match(route, /rejection_reason=\?/);
  assert.match(route, /submitted_at=\?/);
  assert.match(route, /was_reset_to_draft/);
});

test('owners cannot delete pending or approved portfolios', () => {
  assert.match(route, /status IN \('draft','rejected'\)/);
  assert.match(route, /cannot be deleted/i);
});

test('a created portfolio ID is written into history before upload starts', () => {
  const replaceAt = client.indexOf('history.replaceState');
  const uploadAt = client.indexOf('API.uploadDocuments');
  assert.ok(replaceAt > 0, 'history.replaceState is required');
  assert.ok(uploadAt > replaceAt, 'the URL must be stabilized before upload');
});

test('save buttons remain disabled while a request is in flight', () => {
  assert.match(client, /let isSaving = false/);
  assert.match(client, /if \(isSaving\) return/);
  assert.match(client, /setSaving\(true\)/);
  assert.match(client, /finally\s*\{\s*setSaving\(false\)/);
  assert.equal((page.match(/data-portfolio-save/g) || []).length, 2);
});

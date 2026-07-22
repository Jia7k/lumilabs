const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'dashboard.js'),
  'utf8',
);
const notificationsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'notifications.js'),
  'utf8',
);

test('admin dashboard reads the canonical audit reason field', () => {
  assert.match(source, /al\.reason/);
  assert.doesNotMatch(source, /al\.notes/);
});

test('owner and investor message stats use membership cursors, not direct-message fields', () => {
  assert.match(source, /FROM conversation_members cm/);
  assert.match(
    source,
    /GREATEST\(cm\.visible_after_message_id,\s*cm\.last_read_message_id\)/,
  );
  assert.doesNotMatch(source, /receiver_id|messages\.read_at|partnerId/);
});

test('recent interests expose managed-room state for owner and investor dashboards', () => {
  assert.match(source, /AS conversation_id/);
  assert.match(source, /AS conversation_status/);
  assert.match(source, /AS chat_state/);
  assert.match(source, /'awaiting_manager'/);
  assert.match(source, /'archived'/);
  assert.match(source, /'open'/);
});

test('all notification operations hide room notifications after membership removal', () => {
  assert.match(notificationsSource, /n\.related_conversation_id IS NULL/);
  assert.match(notificationsSource, /cm\.conversation_id=n\.related_conversation_id/);
  assert.match(notificationsSource, /cm\.user_id=n\.user_id/);
  assert.match(notificationsSource, /cm\.membership_status='active'/);
  assert.ok(
    notificationsSource.match(/VISIBLE_NOTIFICATION_PREDICATE/g)?.length >= 5,
    'expected the visibility predicate declaration plus list, count, single-read, and read-all usage',
  );
});

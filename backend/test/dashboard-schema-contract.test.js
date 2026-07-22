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
const interestsSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'interests.js'),
  'utf8',
);
const portfoliosSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'portfolios.js'),
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
  assert.match(source, /owner_member\.user_id = p\.owner_id/);
  assert.match(source, /owner_member\.member_role = 'business_owner'/);
  assert.match(source, /owner_member\.membership_status = 'active'/);
});

test('interest lists expose chat state only through the requesting user active membership', () => {
  assert.ok(
    interestsSource.match(/AS conversation_id/g)?.length >= 2,
    'expected investor and owner interest queries to expose conversation IDs',
  );
  assert.ok(
    interestsSource.match(/AS conversation_status/g)?.length >= 2,
    'expected investor and owner interest queries to expose conversation status',
  );
  assert.ok(
    interestsSource.match(/AS chat_state/g)?.length >= 2,
    'expected investor and owner interest queries to expose chat state',
  );
  assert.match(interestsSource, /investor_member\.user_id=ii\.investor_id/);
  assert.match(interestsSource, /investor_member\.member_role='investor'/);
  assert.match(interestsSource, /owner_member\.user_id=p\.owner_id/);
  assert.match(interestsSource, /owner_member\.member_role='business_owner'/);
  assert.ok(
    interestsSource.match(/membership_status='active'/g)?.length >= 2,
    'expected both interest queries to require active membership',
  );
});

test('portfolio lists expose managed chat state only to active owner or investor members', () => {
  assert.ok(
    portfoliosSource.match(/AS conversation_id/g)?.length >= 2,
    'expected owner and browse portfolio queries to expose conversation IDs',
  );
  assert.ok(
    portfoliosSource.match(/AS chat_state/g)?.length >= 2,
    'expected owner and browse portfolio queries to expose chat state',
  );
  assert.match(portfoliosSource, /owner_member\.user_id=\?/);
  assert.match(portfoliosSource, /owner_member\.member_role='business_owner'/);
  assert.match(portfoliosSource, /investor_member\.user_id=\?/);
  assert.match(portfoliosSource, /investor_member\.member_role='investor'/);
  assert.ok(
    portfoliosSource.match(/membership_status='active'/g)?.length >= 2,
    'expected both portfolio queries to require active membership',
  );
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

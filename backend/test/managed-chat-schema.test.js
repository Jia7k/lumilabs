const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(backendRoot, 'schema.sql'), 'utf8');
const migrationPath = path.join(backendRoot, 'scripts', 'migrate-managed-chat.js');

function tableDefinition(name, nextName) {
  const pattern = new RegExp(
    `CREATE TABLE(?: IF NOT EXISTS)? ${name} \\(([\\s\\S]*?)CREATE TABLE(?: IF NOT EXISTS)? ${nextName}`,
  );
  const match = schema.match(pattern);
  assert.ok(match, `${name} table definition must precede ${nextName}`);
  return match[1];
}

function tableStatement(name) {
  const pattern = new RegExp(
    `CREATE TABLE(?: IF NOT EXISTS)? ${name} \\([\\s\\S]*?\\)\\s*(?:ENGINE=[^;]+)?;`,
  );
  const match = schema.match(pattern);
  assert.ok(match, `${name} table statement must exist`);
  return match[0];
}

function declaredColumns(name) {
  return tableStatement(name)
    .split('\n')
    .map((line) => line.match(/^\s{2}([a-z][a-z0-9_]*)\s+/i)?.[1])
    .filter((column) => column && ![
      'CONSTRAINT',
      'FOREIGN',
      'KEY',
      'PRIMARY',
      'UNIQUE',
    ].includes(column.toUpperCase()));
}

test('schema source reproduces audited live column declarations and portfolio order', () => {
  const users = tableStatement('users');
  assert.match(users, /created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.match(
    users,
    /updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/,
  );

  const portfolios = tableStatement('portfolios');
  assert.match(
    portfolios,
    /mvp_status ENUM\('Idea','Prototype','Beta','Launched'\) NOT NULL,/,
  );
  assert.doesNotMatch(
    portfolios,
    /mvp_status ENUM\('Idea','Prototype','Beta','Launched'\)[^,\n]*DEFAULT/,
  );
  assert.match(portfolios, /funding_goal DECIMAL\(15,2\) NOT NULL,/);
  assert.doesNotMatch(portfolios, /funding_goal DECIMAL\(15,2\)[^,\n]*DEFAULT/);
  assert.match(portfolios, /readiness_score INT NULL DEFAULT 0,/);
  assert.doesNotMatch(portfolios, /\bCHECK\s*\(/);
  assert.deepEqual(declaredColumns('portfolios'), [
    'id',
    'owner_id',
    'name',
    'sector',
    'description',
    'mvp_status',
    'funding_goal',
    'team_size',
    'founded_year',
    'location',
    'website',
    'readiness_score',
    'status',
    'rejection_reason',
    'submitted_at',
    'created_at',
    'updated_at',
    'monthly_revenue',
    'user_count',
    'growth_rate',
    'market_size',
    'competitor_analysis',
    'advisor_names',
    'burn_rate',
    'runway_months',
  ]);

  const notifications = tableStatement('notifications');
  assert.match(
    notifications,
    /created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP/,
  );
});

test('every application table pins the live engine and collation', () => {
  for (const name of [
    'users',
    'portfolios',
    'portfolio_documents',
    'investor_interests',
    'conversations',
    'conversation_members',
    'messages',
    'notifications',
    'audit_logs',
  ]) {
    assert.match(
      tableStatement(name),
      /\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;$/,
      `${name} must pin the production table options`,
    );
  }
});

test('notification names reproduce audited production metadata', () => {
  const notifications = tableStatement('notifications');
  for (const index of [
    'user_id',
    'related_portfolio_id',
    'idx_notifications_conversation',
    'idx_notifications_message',
    'related_user_id',
  ]) {
    assert.match(notifications, new RegExp(`KEY ${index} \\(`));
  }
  for (const foreignKey of [
    'notifications_ibfk_1',
    'notifications_ibfk_2',
    'fk_notifications_conversation',
    'fk_notifications_message',
    'notifications_ibfk_3',
  ]) {
    assert.match(
      notifications,
      new RegExp(`CONSTRAINT ${foreignKey} FOREIGN KEY`),
    );
  }
});

test('audit action and portfolio cascade reproduce accepted production behavior', () => {
  const auditLogs = tableStatement('audit_logs');
  assert.match(
    auditLogs,
    /action ENUM\('approved','rejected'\) NOT NULL/,
  );
  assert.match(
    auditLogs,
    /FOREIGN KEY \(portfolio_id\) REFERENCES portfolios\(id\) ON DELETE CASCADE/,
  );
  assert.match(
    schema,
    /Accepted product behavior: deleting an editable portfolio also deletes its audit rows\./,
  );
});

test('authoritative schema defines managed rooms and removes direct-message columns', () => {
  assert.match(
    schema,
    /role ENUM\('business_owner','investor','relationship_manager','admin'\)/,
  );
  assert.match(schema, /CREATE TABLE(?: IF NOT EXISTS)? conversations/);
  assert.match(schema, /UNIQUE KEY unique_conversation_portfolio \(portfolio_id\)/);
  assert.match(schema, /CREATE TABLE(?: IF NOT EXISTS)? conversation_members/);
  assert.match(schema, /singleton_role/);
  assert.match(
    schema,
    /UNIQUE KEY unique_conversation_singleton \(conversation_id, singleton_role\)/,
  );
  assert.match(
    schema,
    /visible_after_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0/,
  );
  assert.match(
    schema,
    /last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0/,
  );

  const messages = tableDefinition('messages', 'notifications');
  assert.match(messages, /conversation_id INT NOT NULL/);
  assert.match(messages, /FOREIGN KEY \(conversation_id, sender_id\)/);
  assert.doesNotMatch(messages, /receiver_id|portfolio_id|read_at/);
});

test('notifications preserve existing types and add managed-room references', () => {
  const notifications = tableDefinition('notifications', 'audit_logs');
  for (const type of [
    'new_message',
    'new_interest',
    'portfolio_approved',
    'portfolio_rejected',
    'portfolio_needs_changes',
    'portfolio_submitted',
    'conversation_created',
    'conversation_member_added',
    'conversation_archived',
  ]) {
    assert.match(notifications, new RegExp(`'${type}'`));
  }
  assert.match(notifications, /related_conversation_id INT NULL/);
  assert.match(notifications, /related_message_id INT NULL/);
  assert.match(
    notifications,
    /FOREIGN KEY \(related_conversation_id\)[\s\S]*?ON DELETE SET NULL/,
  );
  assert.match(
    notifications,
    /FOREIGN KEY \(related_message_id\)[\s\S]*?ON DELETE SET NULL/,
  );
});

test('managed chat migration requires both exact deployment guards', () => {
  assert.equal(fs.existsSync(migrationPath), true, 'migration module must exist');
  const migration = require(migrationPath);

  assert.throws(() => migration.assertMigrationGuards({}), /backup/i);
  assert.throws(
    () => migration.assertMigrationGuards({
      CHAT_BACKUP_VERIFIED: migration.BACKUP_CONFIRMATION,
    }),
    /chat reset confirmation/i,
  );
  assert.equal(
    migration.assertMigrationGuards({
      CHAT_BACKUP_VERIFIED: migration.BACKUP_CONFIRMATION,
      CONFIRM_CHAT_RESET: migration.CHAT_RESET_CONFIRMATION,
    }),
    true,
  );
});

test('guard rejection performs no database query', async () => {
  assert.equal(fs.existsSync(migrationPath), true, 'migration module must exist');
  const { migrateManagedChat } = require(migrationPath);
  let queries = 0;

  await assert.rejects(
    migrateManagedChat({ query: async () => { queries += 1; } }, {}),
    /backup/i,
  );
  assert.equal(queries, 0);
});

test('missing notification columns use MySQL 8 compatible conditional DDL', async () => {
  const source = fs.readFileSync(migrationPath, 'utf8');
  assert.doesNotMatch(source, /ADD COLUMN IF NOT EXISTS/);

  const { ensureColumn } = require(migrationPath);
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (String(sql).includes('information_schema.columns')) return [[], []];
      return [{ affectedRows: 0 }, []];
    },
  };
  await ensureColumn(database, 'notifications', 'related_message_id', 'INT NULL');
  assert.match(calls.at(-1).sql, /ALTER TABLE `notifications` ADD COLUMN `related_message_id` INT NULL/);
  assert.doesNotMatch(calls.at(-1).sql, /IF NOT EXISTS/);
});

test('migration cleanup closes the tunnel even when database close fails', async () => {
  const { releaseMigrationResources } = require('../migrate');
  const events = [];
  await assert.rejects(
    releaseMigrationResources({
      connection: {
        async end() {
          events.push('database');
          throw new Error('database close failed');
        },
      },
      tunnel: {
        server: {
          close(callback) {
            events.push('tunnel');
            callback();
          },
        },
      },
    }),
    /database close failed/,
  );
  assert.deepEqual(events, ['database', 'tunnel']);
});

test('migration validates and snapshots unrelated notification identities before reset', () => {
  const source = fs.readFileSync(migrationPath, 'utf8');
  assert.match(source, /SELECT DISTINCT type FROM notifications/);
  assert.match(source, /unrelatedNotificationIdentities/);
  assert.match(source, /Unrelated notification identities changed/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  deleteEditablePortfolio,
  deletePortfolioDocument,
  resolveStoredUploadPath,
  saveUploadedDocuments,
} = require('../src/services/document-workflow');

const uploadDir = path.join(
  __dirname,
  '..',
  'uploads',
  'portfolio-documents',
);

function fakeDatabase(queryHandler, events = []) {
  const connection = {
    async beginTransaction() {
      events.push('begin');
    },
    async query(sql, params) {
      events.push(`query:${sql.trim().split(/\s+/).slice(0, 3).join(' ')}`);
      return queryHandler(sql, params);
    },
    async commit() {
      events.push('commit');
    },
    async rollback() {
      events.push('rollback');
    },
    release() {
      events.push('release');
    },
  };

  return {
    connection,
    database: {
      async getConnection() {
        events.push('connection');
        return connection;
      },
    },
  };
}

function editablePortfolio() {
  return {
    id: 7,
    owner_id: 3,
    status: 'approved',
    team_size: 3,
    founded_year: 2026,
    monthly_revenue: 100,
    user_count: 20,
    growth_rate: 5,
    description: 'A description long enough to contribute to readiness scoring.',
    market_size: 'Large',
    competitor_analysis: 'Several competitors',
    mvp_status: 'Beta',
    funding_goal: 1000,
    burn_rate: 50,
    runway_months: 12,
  };
}

test('failed uploaded-document transaction removes every newly written file', async () => {
  const events = [];
  const files = [
    {
      path: path.join(uploadDir, 'one.pdf'),
      filename: 'one.pdf',
      originalname: 'one.pdf',
      mimetype: 'application/pdf',
    },
    {
      path: path.join(uploadDir, 'two.pdf'),
      filename: 'two.pdf',
      originalname: 'two.pdf',
      mimetype: 'application/pdf',
    },
  ];
  const { database } = fakeDatabase((sql) => {
    if (/SELECT \* FROM portfolios/.test(sql)) return [[editablePortfolio()], []];
    if (/FROM conversations/.test(sql)) return [[], []];
    if (/INSERT INTO portfolio_documents/.test(sql)) return [{ affectedRows: 2 }, []];
    if (/SELECT COUNT\(\*\)/.test(sql)) return [[{ c: 2 }], []];
    if (/UPDATE portfolios/.test(sql)) throw new Error('portfolio update failed');
    throw new Error(`Unexpected query: ${sql}`);
  }, events);
  const removed = [];

  await assert.rejects(
    saveUploadedDocuments({
      database,
      portfolioId: 7,
      ownerId: 3,
      files,
      calculateReadiness: () => 44,
      fileSystem: {
        async unlink(filePath) {
          removed.push(filePath);
        },
      },
    }),
    /portfolio update failed/,
  );

  assert.deepEqual(removed.sort(), files.map(({ path: filePath }) => filePath).sort());
  assert.ok(events.includes('rollback'));
  assert.ok(events.includes('release'));
  assert.ok(!events.includes('commit'));
});

test('upload enforces five documents total and removes rejected files', async () => {
  const events = [];
  const files = [
    {
      path: path.join(uploadDir, 'sixth.pdf'),
      filename: 'sixth.pdf',
      originalname: 'sixth.pdf',
      mimetype: 'application/pdf',
    },
    {
      path: path.join(uploadDir, 'seventh.pdf'),
      filename: 'seventh.pdf',
      originalname: 'seventh.pdf',
      mimetype: 'application/pdf',
    },
  ];
  const { database } = fakeDatabase((sql) => {
    if (/SELECT \* FROM portfolios/.test(sql)) return [[editablePortfolio()], []];
    if (/FROM conversations/.test(sql)) return [[], []];
    if (/SELECT COUNT\(\*\)/.test(sql)) return [[{ c: 4 }], []];
    throw new Error(`Unexpected query after document limit: ${sql}`);
  }, events);
  const removed = [];

  await assert.rejects(
    saveUploadedDocuments({
      database,
      portfolioId: 7,
      ownerId: 3,
      files,
      calculateReadiness: () => 44,
      fileSystem: {
        async unlink(filePath) {
          removed.push(filePath);
        },
      },
    }),
    (error) => error.status === 400 && /at most 5 documents/.test(error.message),
  );

  assert.equal(removed.length, 2);
  assert.ok(events.includes('rollback'));
  assert.ok(!events.some((event) => event.includes('INSERT INTO portfolio_documents')));
});

test('failed document deletion restores the staged file and rolls back', async () => {
  const events = [];
  const { database } = fakeDatabase((sql) => {
    if (/SELECT \* FROM portfolios/.test(sql)) return [[editablePortfolio()], []];
    if (/SELECT \* FROM portfolio_documents/.test(sql)) {
      return [[{ id: 11, portfolio_id: 7, file_url: '/uploads/portfolio-documents/one.pdf' }], []];
    }
    if (/FROM conversations/.test(sql)) return [[], []];
    if (/DELETE FROM portfolio_documents/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/SELECT COUNT\(\*\)/.test(sql)) return [[{ c: 0 }], []];
    if (/UPDATE portfolios/.test(sql)) throw new Error('score update failed');
    throw new Error(`Unexpected query: ${sql}`);
  }, events);
  const renames = [];

  await assert.rejects(
    deletePortfolioDocument({
      database,
      portfolioId: 7,
      documentId: 11,
      ownerId: 3,
      calculateReadiness: () => 30,
      fileSystem: {
        async rename(from, to) {
          renames.push([from, to]);
        },
        async unlink() {},
      },
    }),
    /score update failed/,
  );

  assert.equal(renames.length, 2);
  assert.equal(renames[0][0], path.join(uploadDir, 'one.pdf'));
  assert.equal(renames[1][0], renames[0][1]);
  assert.equal(renames[1][1], renames[0][0]);
  assert.ok(events.includes('rollback'));
});

test('portfolio deletion commits before purging all staged document files', async () => {
  const events = [];
  const { database } = fakeDatabase((sql) => {
    if (/SELECT \* FROM portfolios/.test(sql)) {
      return [[{ ...editablePortfolio(), status: 'draft' }], []];
    }
    if (/SELECT file_url FROM portfolio_documents/.test(sql)) {
      return [[
        { file_url: '/uploads/portfolio-documents/one.pdf' },
        { file_url: '/uploads/portfolio-documents/two.pdf' },
      ], []];
    }
    if (/FROM conversations/.test(sql)) return [[], []];
    if (/DELETE FROM portfolios/.test(sql)) return [{ affectedRows: 1 }, []];
    throw new Error(`Unexpected query: ${sql}`);
  }, events);
  const fileSystem = {
    async rename(from, to) {
      events.push(`rename:${path.basename(from)}:${path.basename(to)}`);
    },
    async unlink(filePath) {
      events.push(`unlink:${path.basename(filePath)}`);
    },
  };

  await deleteEditablePortfolio({
    database,
    portfolioId: 7,
    ownerId: 3,
    fileSystem,
  });

  const commitAt = events.indexOf('commit');
  const unlinkAt = events.findIndex((event) => event.startsWith('unlink:'));
  assert.ok(commitAt > -1 && unlinkAt > commitAt);
  assert.equal(events.filter((event) => event.startsWith('rename:')).length, 2);
  assert.equal(events.filter((event) => event.startsWith('unlink:')).length, 2);
});

test('approved document upload archives the room before resetting portfolio to draft', async () => {
  const events = [];
  const files = [{
    path: path.join(uploadDir, 'managed.pdf'),
    filename: 'managed.pdf',
    originalname: 'managed.pdf',
    mimetype: 'application/pdf',
  }];
  const { database } = fakeDatabase((sql, params) => {
    if (/SELECT \* FROM portfolios/.test(sql)) return [[editablePortfolio()], []];
    if (/SELECT COUNT\(\*\)/.test(sql)) return [[{ c: 0 }], []];
    if (/FROM conversations/.test(sql)) {
      return [[{
        id: 12,
        portfolio_id: 7,
        title: 'Flow Co',
        status: 'active',
        archived_reason: null,
      }], []];
    }
    if (/FROM conversation_members/.test(sql)) return [[{ user_id: 3 }, { user_id: 8 }], []];
    if (/UPDATE conversations/.test(sql)) {
      assert.equal(params[0], 'portfolio_unapproved');
      return [{ affectedRows: 1 }, []];
    }
    if (/INSERT INTO notifications/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/INSERT INTO portfolio_documents/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/UPDATE portfolios/.test(sql)) return [{ affectedRows: 1 }, []];
    if (/SELECT \* FROM portfolio_documents/.test(sql)) return [[], []];
    throw new Error(`Unexpected query: ${sql}`);
  }, events);

  await saveUploadedDocuments({
    database,
    portfolioId: 7,
    ownerId: 3,
    files,
    calculateReadiness: () => 70,
    fileSystem: { async unlink() {} },
  });

  const archivedAt = events.findIndex((event) => event.includes('UPDATE conversations'));
  const draftedAt = events.findIndex((event) => event.includes('UPDATE portfolios'));
  assert.ok(archivedAt > -1 && archivedAt < draftedAt);
});

test('stored upload paths cannot escape the private upload directory', () => {
  assert.throws(
    () => resolveStoredUploadPath('/uploads/portfolio-documents/../../server.js'),
    /Invalid stored document path/,
  );
  assert.throws(
    () => resolveStoredUploadPath('/etc/passwd'),
    /Invalid stored document path/,
  );
});

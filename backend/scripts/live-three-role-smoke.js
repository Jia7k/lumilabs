require('dotenv').config();

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const origin = String(process.env.LUMILABS_E2E_ORIGIN || '').replace(/\/$/, '');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && origin !== 'http://35.212.144.149') {
  throw new Error(
    'LUMILABS_E2E_ORIGIN must target loopback or the approved public origin',
  );
}

const prefix = `codex_e2e_${Date.now()}`;
const emails = {
  owner: `${prefix}_owner@example.invalid`,
  investor: `${prefix}_investor@example.invalid`,
  admin: `${prefix}_admin@example.invalid`,
};
const generatedCredential = crypto.randomBytes(24).toString('base64url');
let db;

async function api(requestPath, { method = 'GET', token, body, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${origin}/api${requestPath}`, {
    method,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error || payload.errors?.[0]?.msg || 'request failed';
    const error = new Error(
      `${method} ${requestPath}: ${response.status} ${message}`,
    );
    error.status = response.status;
    throw error;
  }
  return { status: response.status, data: payload };
}

async function register(role, email, name) {
  return (await api('/auth/register', {
    method: 'POST',
    body: { role, email, name, password: generatedCredential },
  })).data;
}

async function cleanTemporaryRecords() {
  if (!db) return;

  let cleanupError;
  try {
    const [documents] = await db.query(
      `SELECT d.file_url FROM portfolio_documents d
        JOIN portfolios p ON p.id=d.portfolio_id
        JOIN users u ON u.id=p.owner_id
       WHERE u.email IN (?,?,?)`,
      [emails.owner, emails.investor, emails.admin],
    );
    for (const { file_url: fileUrl } of documents) {
      if (!/^\/uploads\/portfolio-documents\/[A-Za-z0-9._-]+$/.test(fileUrl)) {
        continue;
      }
      const absolute = path.join(
        __dirname,
        '..',
        fileUrl.replace(/^\/uploads\//, 'uploads/'),
      );
      await fs.unlink(absolute).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  } catch (error) {
    cleanupError = error;
  }

  try {
    await db.beginTransaction();
    await db.query(
      `DELETE n FROM notifications n
        JOIN portfolios p ON p.id=n.related_portfolio_id
        JOIN users u ON u.id=p.owner_id
       WHERE u.email IN (?,?,?)`,
      [emails.owner, emails.investor, emails.admin],
    );
    await db.query(
      'DELETE FROM users WHERE email IN (?,?,?)',
      [emails.owner, emails.investor, emails.admin],
    );
    const [remaining] = await db.query(
      'SELECT id FROM users WHERE email IN (?,?,?)',
      [emails.owner, emails.investor, emails.admin],
    );
    assert.equal(remaining.length, 0, 'temporary users must be removed');
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally {
    await db.end();
  }

  if (cleanupError) throw cleanupError;
}

async function main() {
  const databasePort = process.env.SSH_HOST
    ? Number(process.env.DB_TUNNEL_PORT || 3307)
    : Number(process.env.DB_PORT || 3306);
  db = await mysql.createConnection({
    host: '127.0.0.1',
    port: databasePort,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    const adminHash = await bcrypt.hash(generatedCredential, 10);
    await db.execute(
      "INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,'admin')",
      [emails.admin, adminHash, `${prefix} Admin`],
    );

    const owner = await register(
      'business_owner',
      emails.owner,
      `${prefix} Owner`,
    );
    const investor = await register(
      'investor',
      emails.investor,
      `${prefix} Investor`,
    );
    const admin = (await api('/auth/login', {
      method: 'POST',
      body: { email: emails.admin, password: generatedCredential },
    })).data;

    assert.equal(
      (await api('/auth/me', { token: owner.token })).data.role,
      'business_owner',
    );
    assert.equal(
      (await api('/auth/me', { token: investor.token })).data.role,
      'investor',
    );
    assert.equal(
      (await api('/auth/me', { token: admin.token })).data.role,
      'admin',
    );
    await assert.rejects(
      api('/admin/stats', { token: owner.token }),
      (error) => error.status === 403,
    );

    const created = (await api('/portfolios', {
      method: 'POST',
      token: owner.token,
      body: {
        name: `${prefix} Portfolio`,
        sector: 'Technology',
        mvp_status: 'Beta',
        description: 'Temporary end-to-end portfolio used only for deployment verification.',
        funding_goal: 100000,
        team_size: 3,
        founded_year: 2026,
        location: 'Singapore',
        website: '',
        monthly_revenue: 1000,
        user_count: 10,
        growth_rate: 5,
        market_size: 'Temporary market',
        competitor_analysis: 'Temporary comparison',
        advisor_names: '',
        burn_rate: 100,
        runway_months: 12,
      },
    })).data;
    const portfolioId = created.id;

    const form = new FormData();
    const pdf = new Blob(
      [Buffer.from('%PDF-1.4\n%%EOF\n')],
      { type: 'application/pdf' },
    );
    form.append('documents', pdf, `${prefix}.pdf`);
    const uploaded = (await api(`/portfolios/${portfolioId}/documents`, {
      method: 'POST',
      token: owner.token,
      form,
    })).data;
    assert.equal(uploaded.documents.length, 1);

    await api(`/portfolios/${portfolioId}/submit`, {
      method: 'POST',
      token: owner.token,
    });
    const queue = (await api('/admin/queue', { token: admin.token })).data;
    assert.ok(queue.some(({ id }) => Number(id) === Number(portfolioId)));
    await api(`/admin/portfolios/${portfolioId}/approve`, {
      method: 'PUT',
      token: admin.token,
    });

    const browse = (await api('/portfolios', { token: investor.token })).data;
    assert.ok(browse.some(({ id }) => Number(id) === Number(portfolioId)));

    const firstInterest = await api(`/interests/${portfolioId}`, {
      method: 'POST',
      token: investor.token,
    });
    const secondInterest = await api(`/interests/${portfolioId}`, {
      method: 'POST',
      token: investor.token,
    });
    assert.equal(firstInterest.status, 201);
    assert.equal(secondInterest.status, 200);

    await api('/messages', {
      method: 'POST',
      token: owner.token,
      body: {
        receiver_id: investor.user.id,
        portfolio_id: portfolioId,
        content: `${prefix} owner message`,
      },
    });
    await api('/messages', {
      method: 'POST',
      token: investor.token,
      body: {
        receiver_id: owner.user.id,
        portfolio_id: portfolioId,
        content: `${prefix} investor reply`,
      },
    });
    const thread = (await api(
      `/messages/conversations/${owner.user.id}`,
      { token: investor.token },
    )).data;
    assert.ok(thread.some(
      ({ content }) => content === `${prefix} owner message`,
    ));
    assert.ok(thread.some(
      ({ content }) => content === `${prefix} investor reply`,
    ));

    const ownerNotifications = (
      await api('/notifications', { token: owner.token })
    ).data;
    const matchingInterest = ownerNotifications.filter(
      ({ type, related_portfolio_id: relatedPortfolioId }) => (
        type === 'new_interest'
        && Number(relatedPortfolioId) === Number(portfolioId)
      ),
    );
    assert.equal(matchingInterest.length, 1);

    const audit = (
      await api('/admin/audit-logs', { token: admin.token })
    ).data;
    assert.ok(audit.some(({ portfolio_id: auditPortfolioId, action }) => (
      Number(auditPortfolioId) === Number(portfolioId) && action === 'approved'
    )));

    console.log('Live three-role smoke passed');
  } finally {
    await cleanTemporaryRecords();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

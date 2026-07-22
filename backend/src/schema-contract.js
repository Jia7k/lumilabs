const REQUIRED_COLUMNS = {
  users: ['id', 'email', 'password_hash', 'name', 'role'],
  portfolios: [
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
    'monthly_revenue',
    'user_count',
    'growth_rate',
    'market_size',
    'competitor_analysis',
    'advisor_names',
    'burn_rate',
    'runway_months',
    'readiness_score',
    'status',
    'rejection_reason',
    'submitted_at',
    'created_at',
    'updated_at',
  ],
  portfolio_documents: [
    'id',
    'portfolio_id',
    'file_name',
    'file_url',
    'file_type',
    'uploaded_at',
  ],
  investor_interests: ['id', 'investor_id', 'portfolio_id', 'created_at'],
  messages: [
    'id',
    'sender_id',
    'receiver_id',
    'portfolio_id',
    'content',
    'read_at',
    'created_at',
  ],
  notifications: [
    'id',
    'user_id',
    'type',
    'title',
    'body',
    'related_portfolio_id',
    'related_user_id',
    'read_at',
    'created_at',
  ],
  audit_logs: ['id', 'admin_id', 'action', 'portfolio_id', 'reason', 'created_at'],
};

async function verifySchema(database) {
  const [rows] = await database.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()`,
  );

  const available = new Set(
    rows.map((row) => (
      `${row.table_name || row.TABLE_NAME}.${row.column_name || row.COLUMN_NAME}`
    )),
  );
  const missing = [];

  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columns) {
      const field = `${table}.${column}`;
      if (!available.has(field)) missing.push(field);
    }
  }

  if (missing.length) {
    throw new Error(`Missing schema fields: ${missing.join(', ')}`);
  }

  return true;
}

module.exports = { REQUIRED_COLUMNS, verifySchema };

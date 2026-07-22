const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  archiveConversationForPortfolio,
  prepareConversationForPortfolioDeletion,
} = require('./managed-conversation-workflow');

const BACKEND_ROOT = path.join(__dirname, '..', '..');
const DOCUMENT_ROOT = path.join(BACKEND_ROOT, 'uploads', 'portfolio-documents');
const MAX_DOCUMENTS = 5;

class DocumentWorkflowError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function insideDocumentRoot(candidate) {
  return candidate.startsWith(`${DOCUMENT_ROOT}${path.sep}`);
}

function resolveStoredUploadPath(fileUrl) {
  if (
    typeof fileUrl !== 'string'
    || !/^\/uploads\/portfolio-documents\/[A-Za-z0-9._-]+$/.test(fileUrl)
  ) {
    throw new Error('Invalid stored document path');
  }

  const absolute = path.resolve(BACKEND_ROOT, fileUrl.slice(1));
  if (!insideDocumentRoot(absolute)) {
    throw new Error('Invalid stored document path');
  }
  return absolute;
}

function resolveWrittenUploadPath(file) {
  const candidate = file.path
    ? path.resolve(file.path)
    : path.resolve(DOCUMENT_ROOT, file.filename || '');
  if (!file.filename || !insideDocumentRoot(candidate)) {
    throw new Error('Invalid uploaded document path');
  }
  return candidate;
}

async function runEvery(actions) {
  const errors = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Multiple document filesystem operations failed');
  }
}

async function unlinkIfPresent(filePath, fileSystem) {
  try {
    await fileSystem.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function removeWrittenFiles(files, fileSystem) {
  await runEvery(files.map((file) => async () => {
    await unlinkIfPresent(resolveWrittenUploadPath(file), fileSystem);
  }));
}

async function restoreStagedFiles(stagedFiles, fileSystem) {
  await runEvery([...stagedFiles].reverse().map(({ original, staged }) => async () => {
    await fileSystem.rename(staged, original);
  }));
}

async function stageStoredFiles(fileUrls, fileSystem) {
  const stagedFiles = [];
  try {
    for (const fileUrl of new Set(fileUrls)) {
      const original = resolveStoredUploadPath(fileUrl);
      const staged = `${original}.deleting-${crypto.randomUUID()}`;
      try {
        await fileSystem.rename(original, staged);
        stagedFiles.push({ original, staged });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return stagedFiles;
  } catch (error) {
    await restoreStagedFiles(stagedFiles, fileSystem).catch((restoreError) => {
      error.restoreError = restoreError;
    });
    throw error;
  }
}

async function purgeStagedFiles(stagedFiles, fileSystem) {
  await runEvery(stagedFiles.map(({ staged }) => async () => {
    await unlinkIfPresent(staged, fileSystem);
  }));
}

function assertEditablePortfolio(rows) {
  if (!rows.length) {
    throw new DocumentWorkflowError(404, 'Portfolio not found');
  }
  if (rows[0].status === 'pending') {
    throw new DocumentWorkflowError(409, 'A pending portfolio cannot be edited');
  }
  if (!['draft', 'approved', 'rejected'].includes(rows[0].status)) {
    throw new DocumentWorkflowError(409, 'This portfolio cannot be edited right now');
  }
  return rows[0];
}

async function rollback(connection, error) {
  try {
    await connection.rollback();
  } catch (rollbackError) {
    error.rollbackError = rollbackError;
  }
}

function release(connection) {
  try {
    connection.release();
  } catch (releaseError) {
    console.error('Document transaction release failed', releaseError);
  }
}

async function saveUploadedDocuments({
  database,
  portfolioId,
  ownerId,
  files,
  calculateReadiness,
  fileSystem = fs,
}) {
  let connection;
  let transactionOpen = false;

  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    transactionOpen = true;

    const [portfolioRows] = await connection.query(
      'SELECT * FROM portfolios WHERE id=? AND owner_id=? FOR UPDATE',
      [portfolioId, ownerId],
    );
    const portfolio = assertEditablePortfolio(portfolioRows);
    const [[{ c: existingCount }]] = await connection.query(
      'SELECT COUNT(*) AS c FROM portfolio_documents WHERE portfolio_id=?',
      [portfolioId],
    );
    if (Number(existingCount) + files.length > MAX_DOCUMENTS) {
      throw new DocumentWorkflowError(
        400,
        `A portfolio can have at most ${MAX_DOCUMENTS} documents`,
      );
    }

    if (portfolio.status === 'approved') {
      await archiveConversationForPortfolio(
        connection,
        portfolioId,
        'portfolio_unapproved',
        ownerId,
      );
    }

    const values = files.map((file) => [
      portfolioId,
      file.originalname,
      `/uploads/portfolio-documents/${file.filename}`,
      file.mimetype,
    ]);
    await connection.query(
      'INSERT INTO portfolio_documents (portfolio_id,file_name,file_url,file_type) VALUES ?',
      [values],
    );

    const documentCount = Number(existingCount) + files.length;
    const readinessScore = calculateReadiness(portfolio, documentCount);
    await connection.query(
      `UPDATE portfolios
          SET readiness_score=?, status='draft', submitted_at=NULL, rejection_reason=NULL
        WHERE id=?`,
      [readinessScore, portfolioId],
    );
    const [documents] = await connection.query(
      'SELECT * FROM portfolio_documents WHERE portfolio_id=? ORDER BY uploaded_at DESC',
      [portfolioId],
    );

    await connection.commit();
    transactionOpen = false;
    return { documents, readinessScore };
  } catch (error) {
    if (connection && transactionOpen) await rollback(connection, error);
    await removeWrittenFiles(files, fileSystem).catch((cleanupError) => {
      error.cleanupError = cleanupError;
    });
    throw error;
  } finally {
    if (connection) release(connection);
  }
}

async function deletePortfolioDocument({
  database,
  portfolioId,
  documentId,
  ownerId,
  calculateReadiness,
  fileSystem = fs,
}) {
  let connection;
  let transactionOpen = false;
  let stagedFiles = [];
  let readinessScore;

  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    transactionOpen = true;

    const [portfolioRows] = await connection.query(
      'SELECT * FROM portfolios WHERE id=? AND owner_id=? FOR UPDATE',
      [portfolioId, ownerId],
    );
    const portfolio = assertEditablePortfolio(portfolioRows);
    const [documentRows] = await connection.query(
      'SELECT * FROM portfolio_documents WHERE id=? AND portfolio_id=?',
      [documentId, portfolioId],
    );
    if (!documentRows.length) {
      throw new DocumentWorkflowError(404, 'Document not found');
    }

    stagedFiles = await stageStoredFiles(
      [documentRows[0].file_url],
      fileSystem,
    );
    if (portfolio.status === 'approved') {
      await archiveConversationForPortfolio(
        connection,
        portfolioId,
        'portfolio_unapproved',
        ownerId,
      );
    }
    await connection.query(
      'DELETE FROM portfolio_documents WHERE id=?',
      [documentId],
    );
    const [[{ c: documentCount }]] = await connection.query(
      'SELECT COUNT(*) AS c FROM portfolio_documents WHERE portfolio_id=?',
      [portfolioId],
    );
    readinessScore = calculateReadiness(portfolio, Number(documentCount));
    await connection.query(
      `UPDATE portfolios
          SET readiness_score=?, status='draft', submitted_at=NULL, rejection_reason=NULL
        WHERE id=?`,
      [readinessScore, portfolioId],
    );

    await connection.commit();
    transactionOpen = false;
  } catch (error) {
    if (connection && transactionOpen) await rollback(connection, error);
    await restoreStagedFiles(stagedFiles, fileSystem).catch((restoreError) => {
      error.restoreError = restoreError;
    });
    throw error;
  } finally {
    if (connection) release(connection);
  }

  let cleanupError;
  await purgeStagedFiles(stagedFiles, fileSystem).catch((error) => {
    cleanupError = error;
  });
  return { readinessScore, cleanupError };
}

async function deleteEditablePortfolio({
  database,
  portfolioId,
  ownerId,
  fileSystem = fs,
}) {
  let connection;
  let transactionOpen = false;
  let stagedFiles = [];

  try {
    connection = await database.getConnection();
    await connection.beginTransaction();
    transactionOpen = true;

    const [portfolioRows] = await connection.query(
      'SELECT * FROM portfolios WHERE id=? AND owner_id=? FOR UPDATE',
      [portfolioId, ownerId],
    );
    if (!portfolioRows.length) {
      throw new DocumentWorkflowError(404, 'Portfolio not found');
    }
    if (!['draft', 'rejected'].includes(portfolioRows[0].status)) {
      throw new DocumentWorkflowError(
        409,
        'Pending or approved portfolios cannot be deleted',
      );
    }

    const [documents] = await connection.query(
      'SELECT file_url FROM portfolio_documents WHERE portfolio_id=?',
      [portfolioId],
    );
    stagedFiles = await stageStoredFiles(
      documents.map(({ file_url: fileUrl }) => fileUrl),
      fileSystem,
    );
    await prepareConversationForPortfolioDeletion(
      connection,
      portfolioId,
      ownerId,
    );
    const [result] = await connection.query(
      "DELETE FROM portfolios WHERE id=? AND owner_id=? AND status IN ('draft','rejected')",
      [portfolioId, ownerId],
    );
    if (result.affectedRows !== 1) {
      throw new DocumentWorkflowError(409, 'Portfolio could not be deleted');
    }

    await connection.commit();
    transactionOpen = false;
  } catch (error) {
    if (connection && transactionOpen) await rollback(connection, error);
    await restoreStagedFiles(stagedFiles, fileSystem).catch((restoreError) => {
      error.restoreError = restoreError;
    });
    throw error;
  } finally {
    if (connection) release(connection);
  }

  let cleanupError;
  await purgeStagedFiles(stagedFiles, fileSystem).catch((error) => {
    cleanupError = error;
  });
  return { cleanupError };
}

module.exports = {
  DocumentWorkflowError,
  MAX_DOCUMENTS,
  deleteEditablePortfolio,
  deletePortfolioDocument,
  resolveStoredUploadPath,
  saveUploadedDocuments,
};

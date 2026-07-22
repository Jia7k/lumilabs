const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Files land in backend/uploads/portfolio-documents/
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'portfolio-documents');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = {
  'application/pdf': '.pdf',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${ALLOWED_MIME_TYPES[file.mimetype]}`);
  },
});

function fileFilter(req, file, cb) {
  const expected = ALLOWED_MIME_TYPES[file.mimetype];
  const actual = path.extname(file.originalname).toLowerCase();
  if (!expected || actual !== expected) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'documents'));
  }
  return cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB to match frontend's stated limit
    files: 5,
  },
});

module.exports = { upload, fileFilter, ALLOWED_MIME_TYPES };

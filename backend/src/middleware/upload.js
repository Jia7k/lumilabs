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
    // Unique name on disk, user-facing name is preserved separately in file_name
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname) || ALLOWED_MIME_TYPES[file.mimetype] || '';
    cb(null, `${unique}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Allowed: PDF, PPT, PPTX, DOC, DOCX'));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB to match frontend's stated limit
    files: 5,
  },
});

module.exports = upload;

// middlewares/upload.middleware.js
const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Somente imagens (ou PDF, se liberar depois)
  if (/^image\/(png|jpe?g|webp)$/i.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Formato de arquivo não suportado. Apenas imagens PNG/JPG/WEBP são permitidas.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB (ajuste se quiser 5MB)
});

module.exports = upload;

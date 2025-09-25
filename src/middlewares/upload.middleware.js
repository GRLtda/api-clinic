const multer = require('multer');

// Vamos configurar o multer para armazenar o arquivo em memória.
// Assim, não precisamos salvá-lo no disco do servidor antes de enviar para o S3.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Aceita apenas arquivos de imagem
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Formato de arquivo não suportado! Apenas imagens são permitidas.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 1024 * 1024 * 5 }, // Limite de 5MB por arquivo
});

module.exports = upload;
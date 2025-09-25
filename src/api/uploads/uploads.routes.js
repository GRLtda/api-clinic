const express = require('express');
const router = express.Router();
const uploadController = require('./uploads.controller');
const { isAuthenticated } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware'); // Criaremos este

// Rota para upload de imagem. Precisa estar autenticado.
// O middleware 'upload.single('image')' processa o arquivo antes de chegar no controller.
router.post('/image', isAuthenticated, upload.single('image'), uploadController.uploadImage);

module.exports = router;
// api/uploads/uploads.routes.js
const express = require('express');
const router = express.Router();
const uploadController = require('./uploads.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');

// upload de imagem simples (não anexa automaticamente)
router.post('/image', isAuthenticated, requireClinic, upload.single('image'), uploadController.uploadImage);

module.exports = router;

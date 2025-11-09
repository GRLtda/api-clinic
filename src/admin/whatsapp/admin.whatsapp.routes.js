// src/admin/whatsapp/admin.whatsapp.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./admin.whatsapp.controller');
const { isAdminAuthenticated } = require('../middlewares/admin.auth.middleware');

// Protege todas as rotas de WhatsApp Admin
router.use(isAdminAuthenticated);

router.get('/qrcode', controller.getAdminQRCode);
router.get('/status', controller.getAdminStatus);
router.post('/logout', controller.logoutAdminClient);
router.post('/send-message', controller.sendAdminMessage);

module.exports = router;
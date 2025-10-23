// src/api/crm/crm.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./crm.controller');
const { isAuthenticated, requireClinic } = require('../../../middlewares/auth.middleware');

router.use(isAuthenticated, requireClinic);

router.get('/qrcode', controller.getQrCode);
router.get('/status', controller.getConnectionStatus);
router.post('/logout', controller.logoutClient);
router.post('/send-message', controller.sendMessageToPatient);

module.exports = router;
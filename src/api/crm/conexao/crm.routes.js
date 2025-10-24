const express = require('express');
const router = express.Router();
const controller = require('./crm.controller');

const { isAuthenticated, requireClinic } = require('../../../middlewares/auth.middleware');

router.use(isAuthenticated, requireClinic);

router.get('/qrcode', controller.generateQRCode);
router.get('/status', controller.getConnectionStatus);
router.post('/logout', controller.logoutClient);
router.post('/send-message', controller.sendMessageToPatient);
router.post('/send-test', controller.sendTestMessage); 


module.exports = router;
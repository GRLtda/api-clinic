const express = require('express');
const router = express.Router();
const controller = require('./audit-log.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.use(isAuthenticated, requireClinic);

router.get('/', controller.getAuditLogs);

module.exports = router;
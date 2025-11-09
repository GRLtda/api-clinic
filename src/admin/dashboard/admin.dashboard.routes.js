// src/admin/dashboard/admin.dashboard.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./admin.dashboard.controller');
const { isAdminAuthenticated } = require('../middlewares/admin.auth.middleware');

// Protege todas as rotas deste arquivo
router.use(isAdminAuthenticated);

// Rota principal (GET /api/admin/summary)
router.get('/', controller.getAdminSummary);

module.exports = router;
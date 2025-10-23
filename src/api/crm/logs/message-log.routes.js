// src/api/crm/logs/message-log.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./message-log.controller');
const { isAuthenticated, requireClinic } = require('../../../middlewares/auth.middleware');

// Todas as rotas de logs exigem que o usuário esteja logado e tenha uma clínica.
router.use(isAuthenticated, requireClinic);

// Rota para listar os logs de mensagens
router.get('/', controller.getAllLogs);

// Rota de utilidade para listar os status disponíveis (para filtros do frontend)
router.get('/status', controller.getAvailableLogStatus);

module.exports = router;
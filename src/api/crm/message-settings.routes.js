// src/api/crm/message-settings.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./message-settings.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

// Todas as rotas de configurações exigem que o usuário esteja logado e tenha uma clínica.
router.use(isAuthenticated, requireClinic);

// Rotas de configuração de mensagens automáticas
router.post('/', controller.createOrUpdateSetting); // Cria/Atualiza (Upsert)
router.get('/', controller.getAllSettings); // Lista todas as configurações

// Rota de utilidade para listar todos os gatilhos possíveis
router.get('/types', controller.getMessageTypes);

// Rota para deletar por TIPO
router.delete('/:type', controller.deleteSetting);

module.exports = router;
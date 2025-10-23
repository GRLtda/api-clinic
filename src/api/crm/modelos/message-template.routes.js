// src/api/crm/modelos/message-template.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./message-template.controller');
const { isAuthenticated, requireClinic } = require('../../../middlewares/auth.middleware');

// Todas as rotas de modelos exigem que o usuário esteja logado e tenha uma clínica.
router.use(isAuthenticated, requireClinic);

// Rotas de utilidade
router.get('/variables', controller.getAvailableVariables);

// Rotas CRUD
router.post('/', controller.createTemplate);
router.get('/', controller.getAllTemplates);
router.get('/:id', controller.getTemplateById);
router.put('/:id', controller.updateTemplate);
router.delete('/:id', controller.deleteTemplate);

module.exports = router;
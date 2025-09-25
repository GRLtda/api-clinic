const express = require('express');
const router = express.Router();
const controller = require('./anamnesis-template.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

// Todas as rotas para gerenciar modelos de anamnese exigem que o usuário
// esteja logado e tenha uma clínica configurada.
router.use(isAuthenticated, requireClinic);

router.post('/', controller.createTemplate);
router.get('/', controller.getAllTemplates);
router.get('/:id', controller.getTemplateById);
router.put('/:id', controller.updateTemplate);
router.delete('/:id', controller.deleteTemplate);

module.exports = router;
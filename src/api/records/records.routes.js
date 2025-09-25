// api/records/records.routes.js
const express = require('express');
const router = express.Router();
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');
const upload = require('../../middlewares/upload.middleware');
const controller = require('./records.controller');

router.use(isAuthenticated, requireClinic);

// Criar prontuário (entry) vinculado a paciente
router.post('/', controller.createRecordEntry);

// Listar prontuários de um paciente
router.get('/patient/:patientId', controller.getRecordEntriesForPatient);

// --- Gerenciamento de anexos ---

// Adicionar anexos já existentes
router.post('/:recordId/attachments', controller.addAttachments);

// Remover anexo específico
router.delete('/:recordId/attachments/:uploadId', controller.removeAttachment);

// Upload + anexar imagem em uma chamada
router.post('/:recordId/attachments/image', upload.single('image'), controller.uploadAndAttachImage);

module.exports = router;

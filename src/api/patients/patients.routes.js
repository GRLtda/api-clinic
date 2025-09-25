const express = require('express');
const router = express.Router();
const patientController = require('./patients.controller');
const recordController = require('../records/records.controller'); // <-- 1. IMPORTAR O NOVO CONTROLADOR
const anamnesisResponseController = require('../anamnesis/anamnesis-response.controller');

const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.use(isAuthenticated, requireClinic);

// --- Rotas de Pacientes (Existentes) ---
router.post('/', patientController.createPatient);
router.get('/', patientController.getAllPatients);
router.get('/:id', patientController.getPatientById);
router.put('/:id', patientController.updatePatient);
router.delete('/:id', patientController.deletePatient);


// --- Rotas Aninhadas de Prontuário ---
// 2. ADICIONAR AS NOVAS ROTAS AQUI
router.post('/:patientId/records', recordController.createRecordEntry);
router.get('/:patientId/records', recordController.getRecordEntriesForPatient);


module.exports = router;
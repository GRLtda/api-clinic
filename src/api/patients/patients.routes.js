// api/patients/patients.routes.js
const express = require('express');
const router = express.Router();
const patientController = require('./patients.controller');
// const recordController = require('../records/records.controller'); // REMOVER
// const anamnesisResponseController = require('../anamnesis/anamnesis-response.controller'); // REMOVER

const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.use(isAuthenticated, requireClinic);

// Pacientes
router.post('/', patientController.createPatient);
router.get('/', patientController.getAllPatients);
router.get('/:id', patientController.getPatientById);
router.put('/:id', patientController.updatePatient);
router.delete('/:id', patientController.deletePatient);

router.get('/birthdays/month', patientController.getBirthdaysOfMonth);

module.exports = router;

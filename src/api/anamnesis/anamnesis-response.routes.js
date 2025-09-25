const express = require('express');
const router = express.Router();
const controller = require('./anamnesis-response.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

// --- ROTAS PRIVADAS (para o médico logado) ---

// Atribuir uma anamnese a um paciente (já tínhamos, agora no lugar certo)
router.post('/patients/:patientId/anamnesis', isAuthenticated, requireClinic, controller.createAnamnesisForPatient);

// Listar as anamneses de um paciente (já tínhamos, agora no lugar certo)
router.get('/patients/:patientId/anamnesis', isAuthenticated, requireClinic, controller.getAnamnesisForPatient);

// ROTA NOVA: Médico salva/submete as respostas de uma anamnese
router.put('/patients/:patientId/anamnesis/:responseId', isAuthenticated, requireClinic, controller.submitAnamnesisByDoctor);


// --- ROTA PÚBLICA (para o paciente com o link) ---

// ROTA NOVA: Paciente salva/submete as respostas usando o token de acesso
router.put('/anamnesis/public/:token', controller.submitAnamnesisByPatient);

// Rota para o paciente visualizar o formulário (opcional, mas bom ter)
// router.get('/anamnesis/public/:token', controller.getAnamnesisForPatientByToken);


module.exports = router;
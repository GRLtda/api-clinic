// src/app.js (Modificado)
const express = require('express');
const cors = require('cors');

// Importa as rotas
const patientRoutes = require('./api/patients/patients.routes');
const authRoutes = require('./api/auth/auth.routes'); 
const clinicRoutes = require('./api/clinics/clinics.routes');
const appointmentRoutes = require('./api/appointments/appointments.routes'); 
const uploadRoutes = require('./api/uploads/uploads.routes');
const anamnesisTemplateRoutes = require('./api/anamnesis/anamnesis-template.routes');
const anamnesisResponseRoutes = require('./api/anamnesis/anamnesis-response.routes');
// --- IMPORTS DO CRM ---
const crmRoutes = require('./api/crm/conexao/crm.routes'); 
const messageTemplateRoutes = require('./api/crm/modelos/message-template.routes');
const messageSettingsRoutes = require('./api/crm/message-settings.routes'); // <-- NOVO IMPORT
const messageLogRoutes = require('./api/crm/logs/message-log.routes'); // <-- NOVO IMPORT

const app = express();

app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => {
  res.send('API do Sistema de Clínicas no ar!');
});

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/clinics', clinicRoutes); 
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/anamnesis-templates', anamnesisTemplateRoutes);
app.use('/api', anamnesisResponseRoutes); 
app.use('/api/uploads', uploadRoutes);

// Rotas de CRM
app.use('/api/crm', crmRoutes); // Rotas de Conexão WhatsApp
app.use('/api/crm/templates', messageTemplateRoutes); // Rotas de Modelos
app.use('/api/crm/settings', messageSettingsRoutes); // <-- NOVA ROTA PARA CONFIGURAÇÕES
app.use('/api/crm/logs', messageLogRoutes); // <-- NOVA ROTA PARA LOGS

module.exports = app;
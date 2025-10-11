const express = require('express');
const cors = require('cors');

// Importa as rotas
const patientRoutes = require('./api/patients/patients.routes');
const authRoutes = require('./api/auth/auth.routes');
const clinicRoutes = require('./api/clinics/clinics.routes');
const appointmentRoutes = require('./api/appointments/appointments.routes');
const uploadRoutes = require('./api/uploads/uploads.routes');
const recordsRoutes = require('./api/records/records.routes');
const anamnesisTemplateRoutes = require('./api/anamnesis/anamnesis-template.routes');
const anamnesisResponseRoutes = require('./api/anamnesis/anamnesis-response.routes');
const employeeRoutes = require('./api/employees/employees.routes');

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
app.use('/api/records', recordsRoutes);
app.use('/api/anamnesis-templates', anamnesisTemplateRoutes);
app.use('/api', anamnesisResponseRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/employees', employeeRoutes);

module.exports = app;
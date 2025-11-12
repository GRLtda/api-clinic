const express = require("express");
const cors = require("cors");

// Importa as rotas
const { notFound, errorHandler } = require("./middlewares/error.middleware");
const patientRoutes = require("./api/patients/patients.routes");
const authRoutes = require("./api/auth/auth.routes");
const clinicRoutes = require("./api/clinics/clinics.routes");
const appointmentRoutes = require("./api/appointments/appointments.routes");
const uploadRoutes = require("./api/uploads/uploads.routes");
const recordsRoutes = require("./api/records/records.routes");
const anamnesisTemplateRoutes = require("./api/anamnesis/anamnesis-template.routes");
const anamnesisResponseRoutes = require("./api/anamnesis/anamnesis-response.routes");
// --- IMPORTS DO CRM ---
const crmRoutes = require("./api/crm/conexao/crm.routes");
const messageTemplateRoutes = require("./api/crm/modelos/message-template.routes");
const messageSettingsRoutes = require("./api/crm/message-settings.routes");
const messageLogRoutes = require("./api/crm/logs/message-log.routes");
const employeeRoutes = require("./api/employees/employees.routes");
const auditLogRoutes = require("./api/audit/audit-log.routes");
const adminRoutes = require("./admin/admin.routes");

const app = express();

app.use((req, res, next) => {
  setTimeout(next, 5000);
});

app.use(cors());
app.use(express.json());

// Rota de teste
app.get("/", (req, res) => {
  res.send("API do Sistema de Clínicas no ar!");
});

// Rotas da API
app.use("/api/auth", authRoutes);
app.use("/api/clinics", clinicRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/records", recordsRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/anamnesis-templates", anamnesisTemplateRoutes);
app.use("/api", anamnesisResponseRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/employees", employeeRoutes);

// Rotas de CRM
app.use("/api/crm", crmRoutes);
app.use("/api/crm/templates", messageTemplateRoutes);
app.use("/api/crm/settings", messageSettingsRoutes);
app.use("/api/crm/logs", messageLogRoutes);
app.use("/api/audit", auditLogRoutes);

app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

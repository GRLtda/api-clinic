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
const summaryRoutes = require("./api/summary/summary.routes");
const messageTemplateRoutes = require("./api/crm/modelos/message-template.routes");
const messageSettingsRoutes = require("./api/crm/message-settings.routes");
const messageLogRoutes = require("./api/crm/logs/message-log.routes");
const employeeRoutes = require("./api/employees/employees.routes");
const auditLogRoutes = require("./api/audit/audit-log.routes");
const adminRoutes = require("./admin/admin.routes");

const app = express();

app.use(cors());
app.use(express.json());

// Rota de teste
app.get("/", (req, res) => {
  res.send("API do Sistema de Clínicas no ar!");
});

// Rotas da API
app.use("/auth", authRoutes);
app.use("/summary", summaryRoutes);
app.use("/clinics", clinicRoutes);
app.use("/patients", patientRoutes);
app.use("/records", recordsRoutes);
app.use("/appointments", appointmentRoutes);
app.use("/anamnesis-templates", anamnesisTemplateRoutes);
app.use("/", anamnesisResponseRoutes);
app.use("/uploads", uploadRoutes);
app.use("/employees", employeeRoutes);

// Rotas de CRM
app.use("/crm", crmRoutes);
app.use("/crm/templates", messageTemplateRoutes);
app.use("/crm/settings", messageSettingsRoutes);
app.use("/crm/logs", messageLogRoutes);
app.use("/audit", auditLogRoutes);

app.use("/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

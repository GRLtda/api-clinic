// src/admin/admin.routes.js
const express = require('express');
const router = express.Router();

// Importa os módulos de rota específicos do admin
const adminAuthRoutes = require('./auth/admin.auth.routes');
const adminClinicRoutes = require('./clinics/admin.clinics.routes');
const adminDashboardRoutes = require('./dashboard/admin.dashboard.routes');
const adminUserRoutes = require('./users/admin.users.routes');
const adminWhatsappRoutes = require('./whatsapp/admin.whatsapp.routes'); // <-- ADICIONE ESTA LINHA

// Define os sub-caminhos para cada módulo
router.use('/auth', adminAuthRoutes);
router.use('/clinics', adminClinicRoutes);
router.use('/summary', adminDashboardRoutes);
router.use('/users', adminUserRoutes);
router.use('/whatsapp', adminWhatsappRoutes); // <-- ADICIONE ESTA LINHA

module.exports = router;
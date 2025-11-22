// src/api/summary/summary.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./summary.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.use(isAuthenticated, requireClinic);

router.get('/', controller.getClinicDashboard);

module.exports = router;
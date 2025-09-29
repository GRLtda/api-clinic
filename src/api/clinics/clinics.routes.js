// api/clinics/clinics.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./clinics.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.post('/', isAuthenticated, controller.createClinic);
router.put('/', isAuthenticated, requireClinic, controller.updateClinic);

router.get('/summary', isAuthenticated, requireClinic, controller.getClinicSummary);


module.exports = router;

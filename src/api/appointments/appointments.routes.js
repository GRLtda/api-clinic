// api/appointments/appointments.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./appointments.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.use(isAuthenticated, requireClinic);

router.post('/', controller.createAppointment);
router.get('/', controller.getAllAppointments);
router.put('/:id', controller.updateAppointment);

router.patch('/:id/reschedule', controller.rescheduleAppointment);

router.get('/patient/:patientId', controller.getAppointmentsByPatient);
router.delete('/:id', controller.deleteAppointment);

module.exports = router;
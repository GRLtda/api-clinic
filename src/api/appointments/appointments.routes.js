const express = require('express');
const router = express.Router();
const controller = require('./appointments.controller');

const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

router.use(isAuthenticated, requireClinic);

// Rotas existentes
router.post('/', controller.createAppointment);
router.get('/', controller.getAllAppointments);

// Adicionando as novas rotas de update e delete
router.put('/:id', controller.updateAppointment);
router.delete('/:id', controller.deleteAppointment);

module.exports = router;
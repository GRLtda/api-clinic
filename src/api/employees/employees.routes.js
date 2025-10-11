// api/employees/employees.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./employees.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');

// --- ROTA PÚBLICA PARA VERIFICAR CONVITE ---
router.get('/invitation/:token', controller.getInvitationDetailsByToken);

router.use(isAuthenticated, requireClinic);

router.post('/invite', controller.inviteEmployee);
router.get('/', controller.listEmployees);
router.delete('/:id/remove', controller.removeEmployee); // ROTA ATUALIZADA
router.put('/:id/role', controller.updateEmployeeRole);

module.exports = router;
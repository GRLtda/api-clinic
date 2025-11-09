// src/admin/users/admin.users.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./admin.users.controller');
const { isAdminAuthenticated } = require('../middlewares/admin.auth.middleware');

// Protege todas as rotas deste arquivo
router.use(isAdminAuthenticated);

// Rota para listar todos os usuários
router.get('/', controller.getAllUsers);

module.exports = router;
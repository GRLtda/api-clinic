// src/admin/auth/admin.auth.routes.js
const express = require('express');
const router = express.Router();
const { loginAdmin } = require('./admin.auth.controller');

// Rota de login do admin
router.post('/login', loginAdmin);

// (Não há rota de registro)

module.exports = router;
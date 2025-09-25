const express = require('express');
const router = express.Router();
const controller = require('./clinics.controller');
const { isAuthenticated } = require('../../middlewares/auth.middleware'); // Usaremos um middleware novo/dividido

// Rota para criar a clínica. O usuário precisa estar logado (isAuthenticated)
router.post('/', isAuthenticated, controller.createClinic);

module.exports = router;
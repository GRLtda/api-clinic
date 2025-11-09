// src/admin/clinics/admin.clinics.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./admin.clinics.controller');
const { isAdminAuthenticated } = require('../middlewares/admin.auth.middleware');
const mongoose = require('mongoose'); // <-- ADICIONADO

// --- middleware local de validação ---
const validateObjectId = (paramName) => (req, res, next) => {
  const id = req.params[paramName];
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: `Parâmetro ${paramName} inválido.` });
  }
  next();
};
// ------------------------------------

// Protege todas as rotas deste arquivo com o middleware de admin
router.use(isAdminAuthenticated);

// Rota para listar todas as clínicas (com filtros)
router.get('/', controller.getAllClinics);

// Rota para buscar uma clínica específica por ID
router.get('/:id', validateObjectId('id'), controller.getClinicById); // <-- ADICIONADO

module.exports = router;
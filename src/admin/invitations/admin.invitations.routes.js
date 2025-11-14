// src/admin/invitations/admin.invitations.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./admin.invitations.controller');
const { isAdminAuthenticated } = require('../middlewares/admin.auth.middleware');
const mongoose = require('mongoose');

// Middleware de validação de ID
const validateObjectId = (paramName) => (req, res, next) => {
  const id = req.params[paramName];
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: `Parâmetro ${paramName} inválido.` });
  }
  next();
};

// Protege todas as rotas de convite
router.use(isAdminAuthenticated);

// Rotas CRUD
router.post('/', controller.createInvitation);
router.get('/', controller.listInvitations);
router.delete('/:id', validateObjectId('id'), controller.deleteInvitation);

module.exports = router;
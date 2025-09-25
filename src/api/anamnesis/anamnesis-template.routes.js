// api/anamnesis/anamnesis-template.routes.js
const express = require('express');
const router = express.Router();
const controller = require('./anamnesis-template.controller');
const { isAuthenticated, requireClinic } = require('../../middlewares/auth.middleware');
const mongoose = require('mongoose');

// --- middlewares locais de validação leves ---
const validateObjectId = (paramName) => (req, res, next) => {
  const id = req.params[paramName];
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: `Parâmetro ${paramName} inválido.` });
  }
  next();
};

const validateCreate = (req, res, next) => {
  const { name, questions } = req.body || {};
  if (!name || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ message: 'Nome e uma lista de perguntas são obrigatórios.' });
  }
  next();
};

const validateUpdate = (req, res, next) => {
  const { name, questions } = req.body || {};
  if (name === undefined && questions === undefined) {
    return res.status(400).json({ message: 'Forneça ao menos um campo para atualizar (name ou questions).' });
  }
  if (questions !== undefined && (!Array.isArray(questions) || questions.length === 0)) {
    return res.status(400).json({ message: 'questions deve ser um array não vazio.' });
  }
  next();
};

// Todas as rotas exigem autenticação e clínica configurada
router.use(isAuthenticated, requireClinic);

// Criar
router.post('/', validateCreate, controller.createTemplate);

// Listar (nome + id)
router.get('/', controller.getAllTemplates);

// Obter por id (completo)
router.get('/:id', validateObjectId('id'), controller.getTemplateById);

// Atualizar
router.put('/:id', validateObjectId('id'), validateUpdate, controller.updateTemplate);

// Deletar
router.delete('/:id', validateObjectId('id'), controller.deleteTemplate);

module.exports = router;

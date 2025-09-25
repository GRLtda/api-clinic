// api/anamnesis/anamnesis-template.controller.js
const AnamnesisTemplate = require('./anamnesis-template.model');
const AnamnesisResponse = require('../anamnesis/anamnesis-response.model');
const asyncHandler = require('../../utils/asyncHandler');

// Criar
exports.createTemplate = asyncHandler(async (req, res) => {
  const { name, questions } = req.body || {};
  const clinicId = req.clinicId;

  if (!name || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ message: 'Nome e uma lista de perguntas são obrigatórios.' });
    }

  try {
    const newTemplate = await AnamnesisTemplate.create({ name, questions, clinic: clinicId });
    return res.status(201).json(newTemplate);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Um modelo com este nome já existe nesta clínica.' });
    }
    return res.status(500).json({ message: 'Erro ao criar modelo de anamnese.', error: error.message });
  }
});

// Listar nomes/ids
exports.getAllTemplates = asyncHandler(async (req, res) => {
  const templates = await AnamnesisTemplate.find({ clinic: req.clinicId })
    .select('name')
    .sort({ name: 1 })
    .lean();

  return res.status(200).json(templates);
});

// Buscar por id (completo)
exports.getTemplateById = asyncHandler(async (req, res) => {
  const template = await AnamnesisTemplate.findOne({ _id: req.params.id, clinic: req.clinicId }).lean();
  if (!template) {
    return res.status(404).json({ message: 'Modelo de anamnese não encontrado.' });
  }
  return res.status(200).json(template);
});

// Atualizar
exports.updateTemplate = asyncHandler(async (req, res) => {
  const payload = {};
  if (typeof req.body.name === 'string') payload.name = req.body.name;
  if (Array.isArray(req.body.questions)) payload.questions = req.body.questions;

  try {
    const updatedTemplate = await AnamnesisTemplate.findOneAndUpdate(
      { _id: req.params.id, clinic: req.clinicId },
      payload,
      { new: true, runValidators: true, omitUndefined: true }
    );

    if (!updatedTemplate) {
      return res.status(404).json({ message: 'Modelo de anamnese não encontrado.' });
    }
    return res.status(200).json(updatedTemplate);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Um modelo com este nome já existe nesta clínica.' });
    }
    return res.status(500).json({ message: 'Erro ao atualizar o modelo.', error: error.message });
  }
});

// Deletar (bloqueia se houver respostas associadas)
exports.deleteTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clinicId = req.clinicId;

  const inUse = await AnamnesisResponse.exists({ template: id, clinic: clinicId });
  if (inUse) {
    return res.status(409).json({ message: 'Não é possível remover: existem respostas vinculadas a este modelo.' });
  }

  const deleted = await AnamnesisTemplate.findOneAndDelete({ _id: id, clinic: clinicId });
  if (!deleted) {
    return res.status(404).json({ message: 'Modelo de anamnese não encontrado.' });
  }
  return res.status(204).send();
});

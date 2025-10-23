// src/api/crm/modelos/message-template.controller.js
const expressAsyncHandler = require('express-async-handler');
const MessageTemplate = require('./message-template.model');

// ===================================================================
// VARIÁVEIS SUPORTADAS (Para o frontend saber quais usar)
// ===================================================================
exports.SUPPORTED_VARIABLES = [
    '{ paciente }', 
    '{ nome_medico }', 
    '{ clinica }', 
    '{ data_consulta }', 
    '{ hora_consulta }',
    '{ link_anamnese }',
];

/**
 * @desc    Criar um novo modelo de mensagem
 * @route   POST /api/crm/templates
 * @access  Private (Requer clínica)
 */
exports.createTemplate = expressAsyncHandler(async (req, res) => {
  const { name, content, tags } = req.body;
  const clinicId = req.clinicId;

  if (!name || !content) {
    return res.status(400).json({ message: 'Nome e conteúdo da mensagem são obrigatórios.' });
  }

  try {
    const newTemplate = await MessageTemplate.create({
      name,
      content,
      tags,
      clinic: clinicId,
    });

    res.status(201).json(newTemplate);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Um modelo com este nome já existe nesta clínica.' });
    }
    res.status(500).json({ message: 'Erro ao criar modelo de mensagem.', error: error.message });
  }
});

/**
 * @desc    Listar todos os modelos de mensagem da clínica
 * @route   GET /api/crm/templates
 * @access  Private (Requer clínica)
 */
exports.getAllTemplates = expressAsyncHandler(async (req, res) => {
  const templates = await MessageTemplate.find({ clinic: req.clinicId }).sort({ name: 1 });
  res.status(200).json(templates);
});

/**
 * @desc    Buscar um modelo específico por ID
 * @route   GET /api/crm/templates/:id
 * @access  Private (Requer clínica)
 */
exports.getTemplateById = expressAsyncHandler(async (req, res) => {
  const template = await MessageTemplate.findOne({ _id: req.params.id, clinic: req.clinicId });
  
  if (!template) {
    return res.status(404).json({ message: 'Modelo de mensagem não encontrado.' });
  }
  res.status(200).json(template);
});

/**
 * @desc    Atualizar um modelo de mensagem
 * @route   PUT /api/crm/templates/:id
 * @access  Private (Requer clínica)
 */
exports.updateTemplate = expressAsyncHandler(async (req, res) => {
  const updatedTemplate = await MessageTemplate.findOneAndUpdate(
    { _id: req.params.id, clinic: req.clinicId },
    req.body,
    { new: true, runValidators: true }
  );
  
  if (!updatedTemplate) {
    return res.status(404).json({ message: 'Modelo de mensagem não encontrado.' });
  }
  res.status(200).json(updatedTemplate);
});

/**
 * @desc    Deletar um modelo de mensagem
 * @route   DELETE /api/crm/templates/:id
 * @access  Private (Requer clínica)
 */
exports.deleteTemplate = expressAsyncHandler(async (req, res) => {
  const deletedTemplate = await MessageTemplate.findOneAndDelete({ _id: req.params.id, clinic: req.clinicId });
  
  if (!deletedTemplate) {
    return res.status(404).json({ message: 'Modelo de mensagem não encontrado.' });
  }
  res.status(204).send();
});

/**
 * @desc    Retorna a lista de variáveis suportadas
 * @route   GET /api/crm/templates/variables
 * @access  Private (Requer clínica)
 */
exports.getAvailableVariables = (req, res) => {
    res.status(200).json({ variables: exports.SUPPORTED_VARIABLES });
};
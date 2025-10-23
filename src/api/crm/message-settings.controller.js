// src/api/crm/message-settings.controller.js
const expressAsyncHandler = require('express-async-handler');
const MessageSetting = require('./message-settings.model');
const mongoose = require('mongoose'); // Necessário para a validação do ObjectId

/**
 * @desc    Lista todos os tipos de mensagem (gatilhos) disponíveis no sistema.
 * @route   GET /api/crm/settings/types
 * @access  Private (Requer clínica)
 */
exports.getMessageTypes = (req, res) => {
    // A lista de tipos está no model (MESSAGGE_TYPES)
    const types = MessageSetting.schema.path('type').enumValues;
    res.status(200).json({ availableTypes: types });
};

/**
 * @desc    Cria ou atualiza (Upsert) a configuração para um tipo de mensagem.
 * @route   POST /api/crm/settings
 * @access  Private (Requer clínica)
 */
exports.createOrUpdateSetting = expressAsyncHandler(async (req, res) => {
  const { type, templateId, isActive } = req.body;
  const clinicId = req.clinicId;

  // 1. Validação
  if (!type || !templateId) {
    return res.status(400).json({ message: 'Tipo de mensagem e ID do template são obrigatórios.' });
  }

  if (!mongoose.Types.ObjectId.isValid(templateId)) {
      return res.status(400).json({ message: 'ID do template inválido.' });
  }

  // A validação do 'type' é feita automaticamente pelo Mongoose no 'enum'

  // 2. Cria/Atualiza a configuração
  const setting = await MessageSetting.findOneAndUpdate(
    // Procura por uma configuração existente para este TIPO nesta CLÍNICA
    { clinic: clinicId, type: type },
    // Define os novos valores. O 'isActive' é opcional no body.
    {
      template: templateId,
      isActive: isActive !== undefined ? isActive : true, // Se não for informado, assume 'true'
    },
    {
      new: true, // Retorna o documento atualizado
      upsert: true, // Se não existir, cria um novo (Upsert)
      runValidators: true, // Garante que o 'type' seja um dos valores válidos do enum
    }
  );

  // Popula o nome do template no retorno para facilitar a visualização no frontend
  await setting.populate('template', 'name'); 

  res.status(200).json(setting);
});


/**
 * @desc    Lista todas as configurações ativas/inativas da clínica
 * @route   GET /api/crm/settings
 * @access  Private (Requer clínica)
 */
exports.getAllSettings = expressAsyncHandler(async (req, res) => {
  const settings = await MessageSetting.find({ clinic: req.clinicId })
    // Popula o campo 'template' com o ID e o NOME (para exibir qual template está sendo usado)
    .populate('template', 'name')
    .sort({ type: 1 });

  res.status(200).json(settings);
});


/**
 * @desc    Excluir uma configuração (gatilho)
 * @route   DELETE /api/crm/settings/:type
 * @access  Private (Requer clínica)
 */
exports.deleteSetting = expressAsyncHandler(async (req, res) => {
  const { type } = req.params; // O parâmetro é o tipo (string)

  const deletedSetting = await MessageSetting.findOneAndDelete({ 
    clinic: req.clinicId, 
    type: type 
  });

  if (!deletedSetting) {
    return res.status(404).json({ message: 'Configuração não encontrada.' });
  }

  res.status(204).send(); // Sucesso, sem conteúdo
});
// src/api/crm/logs/message-log.controller.js
const expressAsyncHandler = require('express-async-handler');
const { MessageLog, LOG_STATUS, LOG_STATUS_ARRAY, ACTION_TYPES } = require('./message-log.model');
// Note: O MessageSetting.schema.path('type').enumValues deve ser importado
// para o Model, mas não é necessário aqui.

/**
 * Funçao Utilitária: Cria uma nova entrada de log.
 * Deve ser exportada e usada por outros controllers (ex: crm.controller) e por services (scheduler)
 * @param {object} data - Dados do log
 */
exports.createLogEntry = async (data) => {
  try {
    const newLog = await MessageLog.create(data);
    return newLog;
  } catch (error) {
    console.error('ERRO AO CRIAR LOG DE MENSAGEM:', error.message);
    // Não jogamos o erro adiante para não interromper o envio real da mensagem.
    return null;
  }
};

/**
 * @desc    Lista os logs de mensagem da clínica, com filtros de status
 * @route   GET /api/crm/logs
 * @access  Private (Requer clínica)
 */
exports.getAllLogs = expressAsyncHandler(async (req, res) => {
  const { status, patientId, limit = 50, page = 1 } = req.query;
  const clinicId = req.clinicId;

  const query = { clinic: clinicId };

  if (status) {
    query.status = status;
  }
  if (patientId) {
    query.patient = patientId;
  }

  const logs = await MessageLog.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit))
    // Popula o nome do paciente no retorno
    .populate('patient', 'name phone')
    // Popula o nome do template
    .populate('template', 'name');

  const total = await MessageLog.countDocuments(query);

  res.status(200).json({
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    logs,
    availableStatus: LOG_STATUS_ARRAY, // Retorna os status disponíveis para o frontend filtrar
  });
});


/**
 * @desc    Retorna os status de log disponíveis para o frontend filtrar
 * @route   GET /api/crm/logs/status
 * @access  Private (Requer clínica)
 */
exports.getAvailableLogStatus = (req, res) => {
  res.status(200).json({ logStatus: LOG_STATUS_ARRAY, actionTypes: ACTION_TYPES });
};
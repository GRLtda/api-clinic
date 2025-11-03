// src/api/audit/audit-log.service.js
const { AuditLog } = require('./audit-log.model');

// --- Helpers para o Diff ---

// Função segura para pegar propriedades aninhadas (ex: 'address.cep')
const getProperty = (obj, path) => {
  return path.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), obj);
};

// Compara valores (incluindo datas e ObjectIds)
const isDifferent = (oldVal, newVal) => {
  // Converte tipos complexos (Date, ObjectId) para string para comparação simples
  const oldStr = String(oldVal);
  const newStr = String(newVal);
  return oldStr !== newStr;
};
// -------------------------

/**
 * Cria uma nova entrada no log de auditoria.
 * @param {string} userId - ID do usuário (req.user._id)
 * @param {string} clinicId - ID da clínica (req.clinicId)
 * @param {string} action - Ação (AUDIT_ACTIONS)
 * @param {string} entity - Nome da entidade (ex: 'Patient')
 * @param {string} entityId - ID da entidade afetada
 * @param {object} [details] - { changes: [...], summary: '...' }
 */
exports.createLog = async (userId, clinicId, action, entity, entityId, details = {}) => {
  try {
    await AuditLog.create({
      user: userId,
      clinic: clinicId,
      action,
      entity,
      entityId,
      details,
    });
  } catch (error) {
    console.error('Falha ao criar Log de Auditoria:', {
      action,
      entity,
      entityId,
      error: error.message,
    });
  }
};

/**
 * NOVO: Compara dois documentos e gera os 'details' para o log.
 * @param {object} originalDoc - O documento Mongoose .lean() ANTES da mudança
 * @param {object} updatedDoc - O documento Mongoose .lean() DEPOIS da mudança
 * @param {string[]} fieldsToTrack - Array de campos para verificar (ex: ['name', 'address.cep'])
 * @returns {object} - O objeto 'details' pronto para o createLog
 */
exports.generateDiffDetails = (originalDoc, updatedDoc, fieldsToTrack) => {
  const changes = [];

  for (const fieldPath of fieldsToTrack) {
    const oldValue = getProperty(originalDoc, fieldPath);
    const newValue = getProperty(updatedDoc, fieldPath);

    if (isDifferent(oldValue, newValue)) {
      changes.push({
        field: fieldPath,
        old: oldValue || null, // Armazena null se era undefined
        new: newValue || null, // Armazena null se é undefined
      });
    }
  }

  return { changes };
};
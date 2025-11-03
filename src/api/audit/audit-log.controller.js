// src/api/audit/audit-log.controller.js
const { AuditLog } = require('./audit-log.model');
const asyncHandler = require('../../utils/asyncHandler');

/**
 * @desc    Lista os logs de auditoria da clínica (paginado)
 * @route   GET /api/audit
 * @access  Private (Requer clínica)
 */
exports.getAuditLogs = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    userId,
    entity,
    entityId,
  } = req.query;
  
  const clinicId = req.clinicId;

  const pageNum = Math.max(parseInt(page), 1);
  const limitNum = Math.min(Math.max(parseInt(limit), 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const filter = { clinic: clinicId };
  if (userId) filter.user = userId;
  if (entity) filter.entity = entity;
  if (entityId) filter.entityId = entityId;

  const [total, logs] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate('user', 'name email') // Popula o nome do usuário
      .lean(),
  ]);

  res.status(200).json({
    total,
    page: pageNum,
    pages: Math.ceil(total / limitNum) || 1,
    limit: limitNum,
    data: logs,
  });
});
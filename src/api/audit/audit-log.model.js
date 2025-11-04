// src/api/audit/audit-log.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

// Enum para as ações (pode crescer)
const AUDIT_ACTIONS = [
  'CLINIC_UPDATE',
  'PATIENT_CREATE',
  'PATIENT_UPDATE',
  'PATIENT_DELETE',
  'APPOINTMENT_CREATE',
  'APPOINTMENT_UPDATE',
  'APPOINTMENT_RESCHEDULE',
  'APPOINTMENT_STATUS_CHANGE',
  'APPOINTMENT_DELETE',
  'RECORD_CREATE',
  'RECORD_UPDATE',
  // ... outras ações
];

// NOVO: Schema para uma mudança de campo individual
const changeDetailSchema = new Schema({
  field: { type: String, required: true },
  old: { type: Schema.Types.Mixed },
  new: { type: Schema.Types.Mixed },
}, { _id: false });

const auditLogSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clinic: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: AUDIT_ACTIONS,
      required: true,
    },
    entity: {
      type: String,
      required: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    details: {
      changes: [changeDetailSchema],
      summary: { type: String },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

auditLogSchema.index({ clinic: 1, createdAt: -1 });
auditLogSchema.index({ entity: 1, entityId: 1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = {
  AuditLog,
  AUDIT_ACTIONS,
};
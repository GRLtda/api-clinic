// api/records/records.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const medicalRecordEntrySchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    clinic:  { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    author:  { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    appointment: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    content: { type: String, required: true, trim: true },
    attachments: [{ type: Schema.Types.ObjectId, ref: 'Upload' }], // refs para Upload
  },
  { timestamps: true }
);

medicalRecordEntrySchema.index({ patient: 1, createdAt: -1 });

const MedicalRecordEntry = mongoose.model('MedicalRecordEntry', medicalRecordEntrySchema);
module.exports = MedicalRecordEntry;

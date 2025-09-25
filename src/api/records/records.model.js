const mongoose = require('mongoose');
const { Schema } = mongoose;

const medicalRecordEntrySchema = new Schema(
  {
    // Vínculo com o paciente
    patient: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    // Vínculo com a clínica
    clinic: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
    },
    // Vínculo com o usuário (médico) que criou a entrada
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Opcional: Vínculo com o agendamento que originou esta nota
    appointment: {
        type: Schema.Types.ObjectId,
        ref: 'Appointment',
    },
    // O conteúdo principal da nota, vindo do editor de texto rico.
    // Armazenar como String (que pode conter HTML) é uma abordagem comum.
    content: {
      type: String,
      required: true,
      trim: true,
    },
     attachments: [{
    type: Schema.Types.ObjectId,
    ref: 'Upload'
  }]
  },
  {
    timestamps: true, // Adiciona createdAt e updatedAt
  }
);

// Cria um índice para otimizar a busca de prontuários por paciente
medicalRecordEntrySchema.index({ patient: 1, createdAt: -1 });

const MedicalRecordEntry = mongoose.model('MedicalRecordEntry', medicalRecordEntrySchema);

module.exports = MedicalRecordEntry;
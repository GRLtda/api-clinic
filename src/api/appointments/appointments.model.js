const mongoose = require('mongoose');
const { Schema } = mongoose;

const appointmentSchema = new Schema(
  {
    // Vínculo com o paciente que está sendo agendado
    patient: {
      type: Schema.Types.ObjectId,
      ref: 'Patient', // Referencia o modelo 'Patient'
      required: true,
    },
    // Vínculo com a clínica onde ocorre o agendamento
    clinic: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic', // Referencia o modelo 'Clinic'
      required: true,
    },
    // Data e hora do início da consulta
    startTime: {
      type: Date,
      required: true,
    },
    // Data e hora do fim da consulta (útil para calcular duração e evitar sobreposições)
    endTime: {
      type: Date,
      required: true,
    },
    // Observações adicionadas pelo médico ou secretária
    notes: {
      type: String,
      trim: true,
    },
    // Status da consulta para controle de fluxo
    status: {
      type: String,
      enum: ['Agendado', 'Confirmado', 'Realizado', 'Cancelado', 'Não Compareceu'],
      default: 'Agendado',
    },
    // Campo para o agendamento de retorno
    returnInDays: {
      type: Number, // Armazena o número de dias para o retorno
      default: 0,
    },
    // Flag para ativar o envio de lembretes via WhatsApp
    sendReminder: {
      type: Boolean,
      default: false,
    },
    // Controle interno para saber quais lembretes já foram enviados
    remindersSent: {
      oneDayBefore: { type: Boolean, default: false },
      threeHoursBefore: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true, // Adiciona createdAt e updatedAt
  }
);

// Cria um índice para otimizar buscas por data e clínica
appointmentSchema.index({ clinic: 1, startTime: 1 });

const Appointment = mongoose.model('Appointment', appointmentSchema);

module.exports = Appointment;
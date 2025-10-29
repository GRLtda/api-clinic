// src/api/crm/message-settings.model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

// Enum para os tipos de mensagem (gatilhos) que a clínica pode configurar
const MESSAGE_TYPES = [
  "APPOINTMENT_3_MINS_BEFORE",
  "APPOINTMENT_1_DAY_BEFORE",
  "APPOINTMENT_2_DAYS_BEFORE",
  "PATIENT_BIRTHDAY", // Dia do Aniversário
  // Adicionar futuros gatilhos aqui (ex: 'RETURN_IN_30_DAYS', 'CONFIRMATION_REQUEST')
];

const messageSettingSchema = new Schema(
  {
    clinic: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    // O tipo de mensagem (gatilho) configurado
    type: {
      type: String,
      enum: MESSAGE_TYPES,
      required: true,
    },
    // Vínculo com o modelo de mensagem (template) criado pelo usuário
    template: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
      required: true, // Deve ser obrigatório para que a mensagem seja enviada
    },
    // Flag para ativar ou desativar o envio automático para este tipo de mensagem
    isActive: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Garante que uma clínica só pode ter uma configuração para cada TIPO de mensagem.
messageSettingSchema.index({ clinic: 1, type: 1 }, { unique: true });

messageSettingSchema.index({ type: 1, isActive: 1 });

const MessageSetting = mongoose.model("MessageSetting", messageSettingSchema);

module.exports = MessageSetting;

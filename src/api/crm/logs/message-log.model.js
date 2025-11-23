// src/api/crm/logs/message-log.model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

// IMPORT NECESSÁRIO para acessar o enum de tipos de mensagem do MessageSetting
const MessageSetting = require("../message-settings.model");

// Status que a mensagem pode ter
// Status que a mensagem pode ter
const LOG_STATUS = {
  PENDING: "PENDING", // Mensagem na fila de envio (não implementada ainda, mas útil)
  PENDING_CONNECTION: "PENDING_CONNECTION", // Mensagem aguardando conexão do WhatsApp para ser enviada
  SENT_ATTEMPT: "SENT_ATTEMPT", // Tentativa de envio (antes de receber a confirmação do WhatsApp)
  DELIVERED: "DELIVERED", // Entregue (Confirmação do WhatsApp)
  READ: "READ", // Lida (Confirmação do WhatsApp)
  ERROR_WHATSAPP: "ERROR_WHATSAPP", // Erro retornado pelo WhatsApp (ex: número inválido, desconectado)
  ERROR_SYSTEM: "ERROR_SYSTEM", // Erro interno do nosso sistema (ex: falha ao montar o template)
};

const LOG_STATUS_ARRAY = Object.values(LOG_STATUS);

// Tipo de Ação (Para diferenciar logs automáticos de logs manuais)
const ACTION_TYPES = [
  "MANUAL_SEND", // Envio manual pela tela
  "AUTOMATIC_REMINDER", // Envio automático de lembrete
  "AUTOMATIC_BIRTHDAY", // Envio automático de aniversário
];

const messageLogSchema = new Schema(
  {
    clinic: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    patient: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    // Opcional: Se a mensagem foi baseada em um modelo
    template: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
    },
    // Qual tipo de gatilho gerou a mensagem (ex: APPOINTMENT_1_DAY_BEFORE)
    settingType: {
      type: String,
      // AGORA MessageSetting ESTÁ DEFINIDO
      enum: MessageSetting.schema.path("type").enumValues, // Reutiliza o enum de settings
    },
    // Detalhes da mensagem enviada
    messageContent: {
      type: String,
      required: true,
      maxlength: 4096, // Limite razoável para o texto da mensagem
    },
    // Número para o qual a mensagem foi enviada
    recipientPhone: {
      type: String,
      required: true,
    },
    // Status atual da entrega
    status: {
      type: String,
      enum: LOG_STATUS_ARRAY,
      default: LOG_STATUS.SENT_ATTEMPT,
      required: true,
    },
    // Tipo de ação (Manual ou Automática)
    actionType: {
      type: String,
      enum: ACTION_TYPES,
      default: "MANUAL_SEND",
      required: true,
    },
    // Detalhes do erro, se houver
    errorMessage: {
      type: String,
    },
    // ID da mensagem retornado pelo WhatsApp, útil para rastrear confirmações (ACKs)
    wwebjsMessageId: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  {
    timestamps: true, // Adiciona createdAt (data de criação do log) e updatedAt
  }
);

// Cria um índice para otimizar buscas por clínica e paciente, ou por status
messageLogSchema.index({ clinic: 1, createdAt: -1 });
messageLogSchema.index({ clinic: 1, status: 1, createdAt: -1 });

const MessageLog = mongoose.model("MessageLog", messageLogSchema);

module.exports = {
  MessageLog,
  LOG_STATUS,
  LOG_STATUS_ARRAY,
  ACTION_TYPES,
};

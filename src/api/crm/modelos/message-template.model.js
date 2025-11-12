// src/api/crm/modelos/message-template.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const messageTemplateSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // O conteúdo da mensagem com as variáveis {paciente}, {nome_medico}, {clinica} etc.
    content: {
      type: String,
      required: true,
      trim: true,
    },
    // Tags para facilitar a organização no frontend (ex: "Lembrete", "Pós-consulta", "Aniversário")
    tags: [{
      type: String,
      trim: true,
    }],
    // Vínculo com a clínica, garantindo isolamento de dados
    clinic: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
    },
    // Lista de variáveis suportadas (ajuda o frontend a exibir as opções)
    // Inicialmente, definiremos as variáveis hardcoded no controller, mas aqui fica
    // um campo para futuras expansões/customizações se necessário.
    availableVariables: {
        type: [String],
        default: ['{ paciente }', '{ nome_medico }', '{ clinica }', '{ data_consulta }', '{ hora_consulta }', '{ primeiro_nome }'],
        immutable: true, // Variáveis fixas por enquanto
    }
  },
  {
    timestamps: true,
  }
);

// Garante que uma clínica não possa ter dois modelos com o mesmo nome
messageTemplateSchema.index({ clinic: 1, name: 1 }, { unique: true });

const MessageTemplate = mongoose.model('MessageTemplate', messageTemplateSchema);

module.exports = MessageTemplate;
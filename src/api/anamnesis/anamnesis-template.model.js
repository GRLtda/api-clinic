const mongoose = require('mongoose');
const { Schema } = mongoose;

// Este é um "sub-schema". Ele define a estrutura de uma única pergunta dentro do nosso formulário.
const questionSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  questionType: {
    type: String,
    required: true,
    enum: [
      'text',             // Resposta curta
      'long_text',        // Resposta longa (textarea)
      'yes_no',           // Opções 'Sim' e 'Não'
      'yes_no_dontknow',  // Opções 'Sim', 'Não', e 'Não sei'
      'single_choice',    // Múltiplas opções, apenas uma pode ser selecionada
      'multiple_choice',  // Múltiplas opções, várias podem ser selecionadas
    ],
  },
  // Este campo só será usado se questionType for 'single_choice' ou 'multiple_choice'
  options: [{
    type: String,
  }],
}, { _id: false }); // _id: false para não criar IDs para cada pergunta individualmente


// Este é o Schema principal para o modelo de anamnese
const anamnesisTemplateSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    clinic: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
    },
    // Aqui usamos o sub-schema. Cada modelo terá um array de perguntas.
    questions: [questionSchema],
  },
  {
    timestamps: true,
  }
);

// Garante que uma clínica não possa ter dois modelos com o mesmo nome
anamnesisTemplateSchema.index({ clinic: 1, name: 1 }, { unique: true });

const AnamnesisTemplate = mongoose.model('AnamnesisTemplate', anamnesisTemplateSchema);

module.exports = AnamnesisTemplate;
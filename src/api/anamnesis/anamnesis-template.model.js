// api/anamnesis/anamnesis-template.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { nanoid } = require('nanoid'); // Importa o nanoid para IDs únicos

const subQuestionSchema = new Schema(
  {
    // ID único para a pergunta, vital para o frontend e para salvar as respostas
    qId: { type: String, default: () => nanoid(10), required: true, index: true },
    title: { type: String, required: true, trim: true },
    questionType: {
      type: String,
      required: true,
      enum: [
        'text',
        'long_text',
        'yes_no',
        'yes_no_dontknow',
        'single_choice',
        'multiple_choice',
      ],
    },
    options: [{ type: String, trim: true }],
  },
  { _id: false }
);

// Validação de opções para sub-perguntas
subQuestionSchema.pre('validate', function (next) {
  if (
    (this.questionType === 'single_choice' || this.questionType === 'multiple_choice') &&
    (!Array.isArray(this.options) || this.options.length === 0)
  ) {
    return next(new Error('Perguntas de escolha (aninhadas) devem possuir pelo menos uma opção.'));
  }
  next();
});
// --- FIM DO NOVO SCHEMA ---


// --- Schema Principal da Pergunta (Modificado) ---
const questionSchema = new Schema(
  {
    // ID único para a pergunta
    qId: { type: String, default: () => nanoid(10), required: true, index: true },
    title: { type: String, required: true, trim: true },
    questionType: {
      type: String,
      required: true,
      enum: [
        'text',
        'long_text',
        'yes_no',
        'yes_no_dontknow',
        'single_choice',
        'multiple_choice',
      ],
    },
    options: [{ type: String, trim: true }],

    conditionalQuestions: [
      {
        showWhenAnswerIs: { type: Schema.Types.Mixed, required: true },
        questions: [subQuestionSchema],
      },
      { _id: false }
    ],
  },
  { _id: false }
);

// Validação de opções para perguntas principais
questionSchema.pre('validate', function (next) {
  if (
    (this.questionType === 'single_choice' || this.questionType === 'multiple_choice') &&
    (!Array.isArray(this.options) || this.options.length === 0)
  ) {
    return next(new Error('Perguntas de escolha devem possuir pelo menos uma opção.'));
  }
  next();
});
// --- FIM DO SCHEMA MODIFICADO ---


const anamnesisTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    questions: [questionSchema],
  },
  { timestamps: true }
);

anamnesisTemplateSchema.index({ clinic: 1, name: 1 }, { unique: true });

anamnesisTemplateSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const AnamnesisTemplate = mongoose.model('AnamnesisTemplate', anamnesisTemplateSchema);
module.exports = AnamnesisTemplate;
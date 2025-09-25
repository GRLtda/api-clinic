const mongoose = require('mongoose');
const { Schema } = mongoose;
const { randomBytes } = require('crypto'); // Para gerar o token do link

// Sub-schema para armazenar uma única resposta
const answerSchema = new Schema({
  questionTitle: {
    type: String,
    required: true,
  },
  // A resposta pode ser um texto, um array de opções, ou um booleano (sim/não)
  // Usamos Mixed para dar essa flexibilidade.
  answer: {
    type: Schema.Types.Mixed,
    required: true,
  },
}, { _id: false });

const anamnesisResponseSchema = new Schema(
  {
    patient: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    clinic: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
    },
    // Referência ao modelo de formulário que foi usado
    template: {
      type: Schema.Types.ObjectId,
      ref: 'AnamnesisTemplate',
      required: true,
    },
    // Array com as respostas
    answers: [answerSchema],
    // Status para controlar o preenchimento
    status: {
      type: String,
      enum: ['Pendente', 'Preenchido'],
      default: 'Pendente',
    },
    // Quem preencheu as respostas
    answeredBy: {
      type: String,
      enum: ['Médico', 'Paciente'],
    },
    // Token de acesso único para o paciente preencher remotamente
    patientAccessToken: {
      type: String,
      unique: true,
      sparse: true, // Permite valores nulos, mas os que existem devem ser únicos
    },
    patientAccessTokenExpires: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Antes de salvar, se for para o paciente responder, gera um token
anamnesisResponseSchema.pre('save', function (next) {
  if (this.isModified('answeredBy') && this.answeredBy === 'Paciente' && !this.patientAccessToken) {
    // Gera um token aleatório e seguro
    const token = randomBytes(32).toString('hex');
    this.patientAccessToken = token;
    // Define a expiração do token para 7 dias a partir de agora
    this.patientAccessTokenExpires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  }
  next();
});

const AnamnesisResponse = mongoose.model('AnamnesisResponse', anamnesisResponseSchema);

module.exports = AnamnesisResponse;
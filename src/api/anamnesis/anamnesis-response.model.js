// api/anamnesis/anamnesis-response.model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;
const { randomBytes } = require("crypto");
const { nanoid } = require('nanoid');

const answerSchema = new Schema(
  {
    questionTitle: { type: String, required: true, trim: true },
    // Poderíamos armazenar também questionId se desejar evoluir
    answer: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

const anamnesisResponseSchema = new Schema(
  {
    patient: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    clinic: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    template: {
      type: Schema.Types.ObjectId,
      ref: "AnamnesisTemplate",
      required: true,
      index: true,
    },
    answers: [answerSchema],
    status: {
      type: String,
      enum: ["Pendente", "Preenchido"],
      default: "Pendente",
      index: true,
    },
    answeredBy: {
      type: String,
      enum: ["Médico", "Paciente"],
    },
    patientAccessToken: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    patientAccessTokenExpires: { type: Date },
  },
  { timestamps: true }
);

// ---------- Métodos de domínio ----------
anamnesisResponseSchema.methods.generatePatientToken = function (ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const token = nanoid(12); // ~12 caracteres, 71 bits de entropia
  this.patientAccessToken = token;
  this.patientAccessTokenExpires = new Date(Date.now() + ttlMs);
  return token;
};

anamnesisResponseSchema.methods.invalidateToken = function () {
  this.patientAccessToken = undefined;
  this.patientAccessTokenExpires = undefined;
};

anamnesisResponseSchema.methods.markFilled = function (
  by /* 'Médico' | 'Paciente' */
) {
  if (this.status === "Preenchido") {
    // idempotente
    return;
  }
  this.status = "Preenchido";
  this.answeredBy = by;
  this.invalidateToken();
};

// ---------- Validações ----------
anamnesisResponseSchema.pre("validate", function (next) {
  if (
    this.status === "Preenchido" &&
    (!this.answers || this.answers.length === 0)
  ) {
    return next(
      new Error("Não é possível marcar como Preenchido sem respostas.")
    );
  }
  next();
});

// ---------- Índices compostos úteis ----------
anamnesisResponseSchema.index({ clinic: 1, patient: 1, createdAt: -1 });
anamnesisResponseSchema.index({ clinic: 1, template: 1, status: 1 });

// ---------- Saída JSON limpa ----------
anamnesisResponseSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const AnamnesisResponse = mongoose.model(
  "AnamnesisResponse",
  anamnesisResponseSchema
);
module.exports = AnamnesisResponse;

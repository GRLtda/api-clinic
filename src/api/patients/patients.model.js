// api/patients/patients.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const onlyDigits = (v) => (typeof v === 'string' ? v.replace(/\D+/g, '') : v);

const addressSchema = new Schema(
  {
    cep: { type: String, trim: true },
    street: { type: String, trim: true },
    number: { type: String, trim: true },
    district: { type: String, trim: true },
    complement: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
  },
  { _id: false }
);

const patientSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    gender: { type: String, enum: ['Masculino', 'Feminino', 'Outro'] },
    birthDate: {
      type: Date,
      required: true,
      validate: {
        validator: (v) => v instanceof Date && v <= new Date(),
        message: 'Data de nascimento não pode ser no futuro.',
      },
    },
    phone: { type: String, required: true, trim: true },
    cpf: { type: String, trim: true },
    address: addressSchema,
    clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    deletedAt: { type: Date, default: undefined }, // Campo para Soft delete
  },
  { timestamps: true }
);

// ---------- Normalização (remove caracteres não numéricos do telefone e CPF) ----------
function normalizeDoc(doc) {
  if (doc.phone) doc.phone = onlyDigits(doc.phone);
  if (doc.cpf) doc.cpf = onlyDigits(doc.cpf);
}

patientSchema.pre('save', function (next) {
  normalizeDoc(this);
  next();
});

patientSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  if (update.$set) normalizeDoc(update.$set);
  else normalizeDoc(update);
  next();
});

// ---------- ÍNDICES DO BANCO DE DADOS ----------

// 1. Índice de unicidade para o CPF (ignora documentos com soft delete)
patientSchema.index(
  { cpf: 1, clinicId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { deletedAt: { $exists: false } } }
);

patientSchema.index({ name: 'text', cpf: 'text' });


// ---------- Transformação do JSON de saída ----------
patientSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});


const Patient = mongoose.model('Patient', patientSchema);
module.exports = Patient;
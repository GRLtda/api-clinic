const mongoose = require('mongoose');
const { Schema } = mongoose;

const workingHoursSchema = new Schema({
    day: { type: String, enum: ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']},
    startTime: String,
    endTime: String,
    isOpen: { type: Boolean, default: true }
}, { _id: false });

const clinicSchema = new Schema({
  name: { type: String, required: true },
  cnpj: { type: String, unique: true, sparse: true },
  logoUrl: { type: String },
  marketingName: { type: String },
  responsibleName: { type: String, required: true },
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true, // Garante que um usuário só pode ser dono de UMA clínica
  },
  address: {
    cep: String,
    street: String,
    number: String,
    district: String,
    city: String,
    state: String,
  },
  workingHours: [workingHoursSchema],
  plan: {
    type: String,
    enum: ['basic', 'premium', 'enterprise'],
    default: 'basic',
  }
}, { timestamps: true });

const Clinic = mongoose.model('Clinic', clinicSchema);
module.exports = Clinic;
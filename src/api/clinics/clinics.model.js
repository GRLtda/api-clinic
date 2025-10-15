// api/clinics/clinics.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const dayEnum = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

const workingHoursSchema = new Schema(
  {
    day: { type: String, enum: dayEnum, required: true },
    startTime: { type: String, trim: true, match: [/^\d{2}:\d{2}$/, 'Formato HH:mm inválido'], required: true },
    endTime:   { type: String, trim: true, match: [/^\d{2}:\d{2}$/, 'Formato HH:mm inválido'], required: true },
    isOpen: { type: Boolean, default: true },
  },
  { _id: false }
);

const addressSchema = new Schema(
  {
    cep: { type: String, trim: true },
    street: { type: String, trim: true },
    number: { type: String, trim: true },
    district: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
  },
  { _id: false }
);

const clinicSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    cnpj: { type: String, unique: true, sparse: true, trim: true },
    logoUrl: { type: String, trim: true },
    marketingName: { type: String, trim: true },
    responsibleName: { type: String, required: true, trim: true },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    staff: [{
      type: Schema.Types.ObjectId,
      ref: 'User'
    }],
    address: addressSchema,
    workingHours: { type: [workingHoursSchema], default: void 0 },
    allowAppointmentsOutsideWorkingHours: { type: Boolean, default: false },
    plan: {
      type: String,
      enum: ['basic', 'premium', 'enterprise'],
      default: 'basic',
    },
  },
  { timestamps: true }
);

// saída JSON limpa
clinicSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Clinic = mongoose.model('Clinic', clinicSchema);
module.exports = Clinic;
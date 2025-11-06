// api/appointments/appointments.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;


const appointmentSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    clinic:  { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    startTime: { type: Date, required: true },
    endTime:   { type: Date, required: true },
    notes: { type: String, trim: true },
    status: {
      type: String,
      enum: ['Agendado', 'Confirmado', 'Realizado', 'Cancelado', 'Não Compareceu'],
      default: 'Agendado',
    },
    isReturn: { type: Boolean, default: false },
    sendReminder: { type: Boolean, default: false },
    remindersSent: {
      oneDayBefore: { type: Boolean, default: false },
      threeHoursBefore: { type: Boolean, default: false },
      threeMinutesBefore: { type: Boolean, default: true }, 
    },
  },
  { timestamps: true }
);

// validação simples: endTime > startTime
appointmentSchema.pre('validate', function (next) {
  if (this.startTime && this.endTime && this.endTime <= this.startTime) {
    return next(new Error('endTime deve ser maior que startTime.'));
  }
  next();
});

// índices úteis para consultas
appointmentSchema.index({ clinic: 1, startTime: 1 });
appointmentSchema.index({ clinic: 1, patient: 1, startTime: 1 });

// saída JSON limpa
appointmentSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Appointment = mongoose.model('Appointment', appointmentSchema);
module.exports = Appointment;
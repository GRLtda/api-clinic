// api/employees/employees.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { randomBytes } = require('crypto');

const employeeInvitationSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      enum: ['recepcionista', 'medico', 'gerente'],
    },
    clinic: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic',
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    tokenExpires: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Método para gerar o token
employeeInvitationSchema.methods.generateToken = function () {
  const token = randomBytes(32).toString('hex');
  this.token = token;
  // Token expira em 7 dias
  this.tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return token;
};

const EmployeeInvitation = mongoose.model('EmployeeInvitation', employeeInvitationSchema);
module.exports = EmployeeInvitation;
// src/admin/invitations/admin.invitation.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;
const { randomBytes } = require('crypto');

const adminInvitationSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    plan: {
      type: String,
      enum: ['basic', 'premium', 'enterprise'],
      default: 'basic',
      required: true,
    },
    // Token para o link de registro
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
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

/**
 * Gera um token de convite e define a expiração para 3 dias.
 */
adminInvitationSchema.methods.generateToken = function () {
  const token = randomBytes(32).toString('hex');
  this.token = token;
  // Expira em 3 dias
  this.expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  return token;
};

const AdminInvitation = mongoose.model('AdminInvitation', adminInvitationSchema);
module.exports = AdminInvitation;
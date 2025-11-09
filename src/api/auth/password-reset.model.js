// src/api/auth/password-reset.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const passwordResetSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Armazenamos o email para a rota resetPassword (para encontrar o user)
    // ou para referência futura.
    email: {
      type: String,
      required: true,
    },
    code: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      // O MongoDB irá deletar automaticamente o documento 1 hora (3600s) 
      // após o valor definido em 'expiresAt'.
      expires: 3600, 
    },
    // Usamos o createdAt do timestamp para o rate limit de 30s
  },
  {
    timestamps: true, // Adiciona createdAt e updatedAt
  }
);

const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);

module.exports = PasswordReset;
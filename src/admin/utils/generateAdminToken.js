// src/admin/utils/generateAdminToken.js
const jwt = require('jsonwebtoken');

// Gera um token específico para o admin, incluindo a role no payload
module.exports = function generateAdminToken(userId, role) {
  return jwt.sign(
    { id: String(userId), role: role }, // Adiciona a role
    process.env.JWT_SECRET, 
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    }
  );
};
// utils/generateToken.js
const jwt = require('jsonwebtoken');

module.exports = function generateToken(userId) {
  return jwt.sign({ id: String(userId) }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    // algoritmo padrão HS256
  });
};

const crypto = require('crypto');

/**
 * Gera um código numérico de 6 dígitos.
 * @returns {string} - O código de 6 dígitos (ex: "123456")
 */
exports.generateResetCode = () => {
  return crypto.randomInt(100000, 999999).toString();
};
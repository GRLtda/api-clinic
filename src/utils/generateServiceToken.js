// src/utils/generateServiceToken.js
const jwt = require('jsonwebtoken');

// Gera um token para autenticar requisições *para* o serviço WhatsApp
// Inclui o clinicId para que o serviço saiba qual cliente gerenciar
module.exports = function generateServiceToken(clinicId) {
  if (!process.env.WHATSAPP_SERVICE_JWT_SECRET) {
    throw new Error('WHATSAPP_SERVICE_JWT_SECRET não está definido.');
  }
  return jwt.sign(
    { clinicId: String(clinicId), iss: 'api-clinic' }, // iss (issuer) identifica quem gerou o token
    process.env.WHATSAPP_SERVICE_JWT_SECRET,
    { expiresIn: '5m' } // Expira em 5 minutos
  );
};
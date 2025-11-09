// src/services/whatsappServiceClient.js
const axios = require('axios');
const generateServiceToken = require('../utils/generateServiceToken');

const whatsappServiceApi = axios.create({
  baseURL: process.env.WHATSAPP_SERVICE_URL,
});

// Função helper para adicionar o token de serviço a cada requisição
const requestWithServiceAuth = async (clinicId, config) => {
  const token = generateServiceToken(clinicId);
  return whatsappServiceApi({
    ...config,
    headers: {
      ...config.headers,
      'Authorization': `Bearer ${token}`,
    },
  });
};

// Funções para interagir com o serviço WhatsApp
exports.getQRCode = (clinicId) => {
  return requestWithServiceAuth(clinicId, {
    method: 'GET',
    url: '/qrcode',
  });
};

exports.getStatus = (clinicId) => {
  return requestWithServiceAuth(clinicId, {
    method: 'GET',
    url: '/status',
  });
};

exports.logout = (clinicId) => {
  return requestWithServiceAuth(clinicId, {
    method: 'POST',
    url: '/logout',
  });
};

/**
 * MODIFICADO: Agora aceita um objeto de opções para botões e rodapé.
 * @param {string} clinicId - ID da clínica
 * @param {string} to - Número do destinatário
 * @param {string} message - Corpo da mensagem
 * @param {object} [options] - Opções adicionais
 * @param {string} [options.footer] - Rodapé da mensagem
 * @param {Array<object>} [options.buttons] - Array de botões (ex: [{id, text}])
 */
exports.sendMessage = (clinicId, to, message, options = {}) => {
  const { footer, buttons } = options;

  return requestWithServiceAuth(clinicId, {
    method: 'POST',
    url: '/send-message',
    // O 'data' agora inclui os campos opcionais
    data: { 
      to, 
      message, 
      footer, // Adicionado
      buttons // Adicionado
    },
  });
};
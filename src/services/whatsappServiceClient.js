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

exports.sendMessage = (clinicId, to, message) => {
  return requestWithServiceAuth(clinicId, {
    method: 'POST',
    url: '/send-message',
    data: { to, message }, // 'to' deve ser o número de telefone
  });
};
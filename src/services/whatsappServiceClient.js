// src/services/whatsappServiceClient.js
const axios = require('axios');
const Clinic = require('../api/clinics/clinics.model'); // Importa o model para persistência

// Configuração da API ZAP
// Usa a URL de produção como fallback se a variável de ambiente não estiver definida
const API_URL = process.env.WHATSAPP_SERVICE_URL || 'https://apizap.squareweb.app';
const API_KEY = process.env.WHATSAPP_SERVICE_API_KEY;

if (!process.env.WHATSAPP_SERVICE_URL) {
  console.warn(`[WhatsAppService] WHATSAPP_SERVICE_URL não definido. Usando fallback: ${API_URL}`);
}

if (!API_KEY) {
  console.warn('[WhatsAppService] WHATSAPP_SERVICE_API_KEY não definido. O envio de mensagens falhará.');
}

const zapApi = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  }
});

/**
 * Obtém o sessionId (e status) chamando o endpoint /connect.
 * Usa o clinicId como sessionName.
 * 
 * LÓGICA DE PERSISTÊNCIA:
 * 1. Chama /connect.
 * 2. Se retornar sessionId (novo ou reconectado com dados), SALVA no banco.
 * 3. Se NÃO retornar sessionId (já conectado), BUSCA do banco.
 */
const getSessionInfo = async (clinicId) => {
  try {
    // Garante que clinicId seja string
    const sessionName = String(clinicId);
    // console.log(`[WhatsAppService] Buscando sessão para clinicId: ${clinicId} (sessionName: ${sessionName})`);

    const response = await zapApi.post('/connect', {
      sessionName: sessionName
    });

    const zapData = response.data;
    // console.log(`[WhatsAppService] Resposta /connect para ${sessionName}:`, JSON.stringify(zapData, null, 2));

    let sessionId = zapData.data?.sessionId;

    if (sessionId) {
      // console.log(`[WhatsAppService] SessionId recebido da API (${sessionId}). Atualizando banco...`);
      await Clinic.findByIdAndUpdate(clinicId, { whatsappSessionId: sessionId });
    } else {
      // console.log('[WhatsAppService] SessionId não retornado pela API. Buscando no banco de dados...');
      const clinic = await Clinic.findById(clinicId).select('whatsappSessionId');

      if (clinic && clinic.whatsappSessionId) {
        sessionId = clinic.whatsappSessionId;
        // console.log(`[WhatsAppService] SessionId recuperado do banco: ${sessionId}`);

        if (zapData.data) {
          zapData.data.sessionId = sessionId;
        }
      } else {
        // console.warn(`[WhatsAppService] ALERTA: SessionId não encontrado no banco para a clínica ${clinicId}.`);
      }
    }

    return zapData;
  } catch (error) {
    console.error(`[WhatsAppService] Erro ao obter sessão para ${clinicId}:`, error.response?.data || error.message);
    throw error;
  }
};

exports.getQRCode = async (clinicId) => {
  try {
    const sessionInfo = await getSessionInfo(clinicId);
    return {
      status: 200,
      data: sessionInfo.data
    };
  } catch (error) {
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { message: 'Erro ao obter QR Code.' }
    };
  }
};

exports.getStatus = async (clinicId) => {
  try {
    const sessionInfo = await getSessionInfo(clinicId);
    return {
      status: 200,
      data: sessionInfo.data
    };
  } catch (error) {
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { message: 'Erro ao obter status.' }
    };
  }
};

exports.logout = async (clinicId) => {
  try {
    const sessionInfo = await getSessionInfo(clinicId);
    const sessionId = sessionInfo?.data?.sessionId;

    if (!sessionId) {
      return {
        status: 200,
        data: { message: 'Nenhuma sessão ativa para desconectar.' }
      };
    }

    const response = await zapApi.post('/logout', {
      sessionId: sessionId
    });

    await Clinic.findByIdAndUpdate(clinicId, { whatsappSessionId: null });

    return {
      status: 200,
      data: response.data
    };
  } catch (error) {
    console.error(`[WhatsAppService] Erro ao desconectar sessão para clinicId ${clinicId}:`, error.response?.data || error.message);
    return {
      status: error.response?.status || 500,
      data: error.response?.data || { message: 'Erro interno ao desconectar a sessão.' }
    };
  }
};

exports.sendMessage = async (clinicId, to, message, options = {}) => {
  console.log(`[WhatsAppService] Iniciando envio de mensagem para ${to} (Clinic: ${clinicId})`);
  try {
    const sessionInfo = await getSessionInfo(clinicId);

    const sessionId = sessionInfo?.data?.sessionId;

    if (!sessionId) {
      throw new Error('Sessão desconectada ou inválida. Por favor, desconecte e escaneie o QR Code novamente no painel.');
    }

    let formattedNumber = String(to).replace(/\D/g, '');
    if (!formattedNumber.startsWith('55')) {
      formattedNumber = '55' + formattedNumber;
    }
    const payload = {
      sessionId: sessionId,
      number: formattedNumber,
      message: message
    };
    const response = await zapApi.post('/send', payload);
    const zapData = response.data;

    const mappedData = {
      message: 'Mensagem enviada com sucesso.',
      result: {
        id: zapData.data?.id,
        status: zapData.data?.status || 'success'
      },
      originalResponse: zapData
    };

    return {
      status: 200,
      data: mappedData
    };

  } catch (error) {
    console.error(`[WhatsAppService] Erro ao enviar mensagem para ${to}:`, error.response?.data || error.message);

    const errorMessage = error.response?.data?.message || error.message || 'Erro ao enviar mensagem.';

    return {
      status: error.response?.status || 500,
      data: {
        message: errorMessage,
        error: error.response?.data
      }
    };
  }
};
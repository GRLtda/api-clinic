// src/api/crm/conexao/whatsapp.client.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
// const mongoose = require('mongoose'); // Mongoose é necessário se for usar MongoStore

// Objeto para gerenciar as instâncias do Client (uma por clínica)
const clients = new Map();

// Estrutura de status: 'disconnected', 'qr_ready', 'connected', 'initializing'
const clientStatus = new Map(); 

/**
 * Retorna o status atual do cliente para uma clínica.
 * @param {string} clinicId
 * @returns {string}
 */
const getClientStatus = (clinicId) => {
  return clientStatus.get(clinicId) || 'disconnected';
};

/**
 * Inicializa ou retorna o cliente WhatsApp para uma clínica.
 * @param {string} clinicId
 * @returns {Promise<Client>}
 */
const initializeClient = async (clinicId) => {
  const id = clinicId.toString();

  // Se o cliente já está na lista e conectado/pronto, apenas retorna.
  if (clients.has(id) && getClientStatus(id) !== 'disconnected') {
    return clients.get(id);
  }
  
  // --- Estratégia de Autenticação (LocalAuth para simplicidade) ---
  // Para usar o MongoDB: você precisaria configurar o MongoStore aqui.
  // Ex: const store = new MongoStore({ mongoose: mongoose, collectionName: 'whatsappSessions' });
  // Ex: const authStrategy = new RemoteAuth({ store: store, clientId: id });
  const authStrategy = new LocalAuth({ clientId: id }); // Armazena a sessão em arquivos

  // Cria um novo cliente
  const client = new Client({
    authStrategy: authStrategy,
    webVersionCache: {
        type: 'remote',
        // Usa uma versão estável
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html', 
    }
  });

  // Atualiza o mapa de clientes e status
  clients.set(id, client);
  clientStatus.set(id, 'initializing');
  
  // --- LISTENERS DE EVENTOS ---

  client.on('qr', async (qr) => {
    clientStatus.set(id, 'qr_ready');
    // Armazena o QR como Data URL para ser lido pelo controller
    client.qrCode = await qrcode.toDataURL(qr);
    console.log(`[${id}] QR_RECEIVED. Status: ${getClientStatus(id)}`);
  });

  client.on('ready', () => {
    clientStatus.set(id, 'connected');
    client.qrCode = null; // Limpa o QR code
    console.log(`[${id}] Client is ready! Status: ${getClientStatus(id)}`);
  });

  client.on('auth_failure', (msg) => {
    console.error(`[${id}] AUTHENTICATION FAILURE`, msg);
    clientStatus.set(id, 'disconnected');
  });

  client.on('disconnected', (reason) => {
    clientStatus.set(id, 'disconnected');
    console.log(`[${id}] Client was disconnected! Reason: ${reason}. Status: ${getClientStatus(id)}`);
  });

  // Tenta inicializar o cliente.
  client.initialize().catch(err => {
    console.error(`[${id}] Erro ao inicializar o cliente:`, err.message);
    clientStatus.set(id, 'disconnected');
    // Se a inicialização falhar de forma catastrófica
    // clients.delete(id); 
  });

  return client;
};

/**
 * Deleta a sessão salva e destrói a instância do cliente.
 * @param {string} clinicId
 */
const destroyClient = async (clinicId) => {
  const id = clinicId.toString();
  const client = clients.get(id);
  
  if (client) {
    try {
      if (getClientStatus(id) === 'connected') {
        // Encerra a sessão ativa no WhatsApp
        await client.logout();
      }
      // Deleta a sessão salva (arquivos/DB) e destrói o processo do navegador
      await client.destroy(); 
      console.log(`[${id}] Client destroyed and session deleted.`);
    } catch (error) {
      console.error(`[${id}] Erro ao destruir/deslogar cliente:`, error.message);
    }
    clients.delete(id);
    clientStatus.delete(id);
  }
};

/**
 * Envia uma mensagem de texto.
 * @param {string} clinicId
 * @param {string} number Número de telefone (ex: 5511999998888)
 * @param {string} message Conteúdo da mensagem
 */
const sendMessage = async (clinicId, number, message) => {
  const id = clinicId.toString();
  const client = clients.get(id);
  
  if (!client || getClientStatus(id) !== 'connected') {
    throw new Error('Cliente WhatsApp não conectado. Por favor, conecte a clínica primeiro.');
  }

  // O wwebjs precisa do formato '5511999998888@c.us'
  const chatId = `${number.replace(/[^0-9]/g, '')}@c.us`;

  try {
    const result = await client.sendMessage(chatId, message);
    return result;
  } catch (error) {
    console.error(`[${id}] Erro ao enviar mensagem para ${chatId}:`, error);
    throw new Error('Falha ao enviar mensagem: ' + error.message);
  }
};

module.exports = {
  initializeClient,
  getClientStatus,
  destroyClient,
  sendMessage,
};
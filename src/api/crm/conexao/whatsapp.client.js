// src/api/crm/conexao/whatsapp.client.js

// Importações do whatsapp-web.js
const { Client } = require("whatsapp-web.js"); // Usará o puppeteer-core
const { MongoStore } = require("wwebjs-mongo");
const { RemoteAuth } = require("whatsapp-web.js");

// Importações de infra
const qrcode = require("qrcode");
const mongoose = require("mongoose");
const path = require("path");
const os = require("os");

// ===================================================================
// DETECÇÃO DE AMBIENTE
// ===================================================================
const IS_SERVERLESS = process.env.VERCEL === "1";

let chromium;
if (IS_SERVERLESS) {
  try {
    // Tenta carregar o NOVO pacote serverless
    chromium = require("@sparticuz/chromium");
  } catch (e) {
    console.error("Falha ao carregar @sparticuz/chromium", e);
  }
}

// ===================================================================
// ARMAZENAMENTO E CONFIGURAÇÃO GLOBAL
// ===================================================================
const clients = new Map();
const qrCodes = new Map();
const creatingQr = new Map();
let mongoStore;

// (initializeMongoStore permanece o mesmo)
const initializeMongoStore = () => {
  if (!mongoose.connection.readyState) {
    console.error(
      "Mongoose não está conectado. Não foi possível inicializar o MongoStore."
    );
    return;
  }
  if (!mongoStore) {
    mongoStore = new MongoStore({ mongoose: mongoose });
    console.log("MongoStore para sessões WhatsApp inicializado.");
  }
};

// (getClientStatus permanece o mesmo)
const getClientStatus = (clinicId) => {
  const id = clinicId.toString();
  const client = clients.get(id);

  if (!client) return "disconnected";
  if (client.info && client.info.wid) return "connected";
  if (qrCodes.has(id)) return "qrcode_pending";
  if (
    creatingQr.has(id) ||
    client.state === "INITIALIZING" ||
    client.state === "CONFLICT" ||
    client.state === "UNPAIRED" ||
    (client.state === "UNPAIRED_IDLE" && !qrCodes.has(id))
  ) {
    return "creating_qr";
  }
  return "disconnected";
};

// (logoutAndRemoveClient permanece o mesmo)
const logoutAndRemoveClient = async (clinicId) => {
  const id = clinicId.toString();
  if (clients.has(id)) {
    const client = clients.get(id);
    try {
      if (client.info) await client.logout();
    } catch (error) {
      console.warn(
        `[LOGOUT] Cliente ${id}: Erro seguro ao tentar logout. ${error.message}`
      );
    }
    try {
      if (client.pupBrowser) await client.destroy();
      else
        console.warn(
          `[DESTROY] Cliente ${id}: Browser (pupBrowser) não encontrado, pulando destroy.`
        );
    } catch (error) {
      console.warn(
        `[DESTROY] Cliente ${id}: Erro seguro ao tentar destruir. ${error.message}`
      );
    }
    clients.delete(id);
  }
  qrCodes.delete(id);
  creatingQr.delete(id);
  console.log(`[CLIENT] Cliente ${id} removido e limpo da memória.`);
};

// ===================================================================
// FUNÇÕES DE GERENCIAMENTO DE CLIENTE
// ===================================================================

const initializeClient = async (clinicId) => {
  const id = clinicId.toString();

  if (clients.has(id)) {
    const client = clients.get(id);
    if (client.info || client.state === "INITIALIZING") {
      return client;
    }
  }

  if (!mongoStore) {
    throw new Error(
      "MongoStore não inicializado. Chame initializeMongoStore() no server.js primeiro."
    );
  }

  await logoutAndRemoveClient(id);
  creatingQr.set(id, true);
  console.log(`[CLIENT] Marcando criação de QR code para ${id}`);

  // ===================================================================
  // CONFIGURAÇÃO CONDICIONAL (Local vs Serverless)
  // ===================================================================

  // Usa o diretório temporário padrão do sistema operacional
  const dataPath = path.join(os.tmpdir(), ".wwebjs_auth", `session-${id}`);
  console.log(`[CLIENT] Usando dataPath: ${dataPath}`);

  const authStrategy = new RemoteAuth({
    store: mongoStore,
    clientId: id,
    backupSyncIntervalMs: 300000,
    dataPath: dataPath,
  });

  // Configurações do Puppeteer
  let puppeteerConfig = {
    headless: 'new', // <-- MUDANÇA: 'new' é o novo padrão para headless
    dataPath: dataPath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  };

  if (IS_SERVERLESS) {
    // Configuração SERVERLESS (usando @sparticuz/chromium)
    console.log("[CLIENT] Detectado ambiente Serverless. Usando @sparticuz/chromium.");
    if (!chromium || !(await chromium.executablePath())) { // <-- MUDANÇA: Checagem mais robusta
      throw new Error(
        "Ambiente serverless detectado, mas @sparticuz/chromium falhou ao carregar."
      );
    }

    puppeteerConfig.executablePath = await chromium.executablePath();
    puppeteerConfig.args = [
      ...chromium.args,
      ...puppeteerConfig.args,
    ];
    puppeteerConfig.defaultViewport = chromium.defaultViewport;
    
  } else {
    // Configuração LOCAL
    console.log(
      "[CLIENT] Detectado ambiente Local. Usando puppeteer-core/chrome local."
    );
    // puppeteer-core tentará encontrar uma instalação local do Chrome.
  }

  const client = new Client({
    authStrategy: authStrategy,
    puppeteer: puppeteerConfig,
    // webVersionCache removido
  });

  // ===================================================================

  // (Listeners permanecem os mesmos)
  client.on("qr", async (qr) => {
    console.log(`[QR_CODE] recebido para ${id}`);
    const qrDataUrl = await qrcode.toDataURL(qr);
    qrCodes.set(id, qrDataUrl);
    creatingQr.delete(id);
    console.log(
      `[CLIENT] QR code gerado para ${id}, removendo flag de criação`
    );
  });

  client.on("ready", () => {
    console.log(`[CLIENT] Cliente ${id} está PRONTO!`);
    qrCodes.delete(id);
    creatingQr.delete(id);
  });

  client.on("authenticated", () => {
    console.log(`[AUTH] Sessão ${id} restaurada do MongoDB.`);
    creatingQr.delete(id);
  });

  client.on("auth_failure", (msg) => {
    console.error(`[AUTH_FAILURE] Cliente ${id}:`, msg);
    creatingQr.delete(id);
  });

  client.on("disconnected", (reason) => {
    console.log(`[DISCONNECTED] Cliente ${id}:`, reason);
    qrCodes.delete(id);
    creatingQr.delete(id);
  });

  // (Inicialização permanece a mesma)
  client.initialize().catch((err) => {
    console.error(`[ERROR] ERRO ao inicializar o cliente ${id}:`, err);
    creatingQr.delete(id);
    logoutAndRemoveClient(clinicId);
  });

  clients.set(id, client);
  return client;
};

// ===================================================================
// FUNÇÃO DE ENVIO DE MENSAGEM
// ===================================================================
// (sendMessage permanece o mesmo)
const sendMessage = async (clinicId, number, message) => {
  const id = clinicId.toString();
  const client = clients.get(id);

  if (!client || getClientStatus(id) !== "connected") {
    throw new Error(
      "Cliente WhatsApp não conectado. Por favor, conecte a clínica primeiro."
    );
  }

  const chatId = number.endsWith("@c.us") ? number : `${number}@c.us`;

  try {
    const result = await client.sendMessage(chatId, message);
    return result;
  } catch (error) {
    console.error(
      `[${id}] Falha ao enviar mensagem para ${number}:`,
      error.message
    );
    throw new Error(`Falha ao enviar mensagem: ${error.message}`);
  }
};

// ===================================================================
// EXPORTS
// ===================================================================

module.exports = {
  initializeMongoStore,
  initializeClient,
  getClientStatus,
  logoutAndRemoveClient,
  sendMessage,
  clients,
  qrCodes,
};
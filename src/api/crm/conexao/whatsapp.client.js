// src/api/crm/conexao/whatsapp.client.js

// Importações (fs, os, path, mongoose, qrcode, etc.)
const { Client } = require("whatsapp-web.js");
const { MongoStore } = require("wwebjs-mongo");
const { RemoteAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const mongoose = require("mongoose");
const path = require("path");
const os = require("os");
const fs = require("fs");

// ===================================================================
// DETECÇÃO DE AMBIENTE
// ===================================================================
const IS_SERVERLESS = process.env.VERCEL === "1";

let chromium;
if (IS_SERVERLESS) {
  try {
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

  if (IS_SERVERLESS) {
    try {
      process.chdir(os.tmpdir());
      console.log(`[CLIENT] Diretório de trabalho alterado para: ${os.tmpdir()}`);
    } catch (err) {
      console.error(`[CLIENT] Falha ao alterar diretório: ${err.message}`);
      throw new Error(`Falha ao alterar diretório: ${err.message}`);
    }
  }

  const dataPath = path.join(os.tmpdir(), ".wwebjs_auth", `session-${id}`);
  console.log(`[CLIENT] Usando dataPath: ${dataPath}`);

  if (!fs.existsSync(dataPath)) {
    try {
      fs.mkdirSync(dataPath, { recursive: true });
      console.log(`[CLIENT] Diretório dataPath criado: ${dataPath}`);
    } catch (err) {
      console.error(`[CLIENT] Falha ao criar dataPath: ${err.message}`);
      throw new Error(`Falha ao criar diretório de sessão: ${err.message}`);
    }
  }

  const authStrategy = new RemoteAuth({
    store: mongoStore,
    clientId: id,
    backupSyncIntervalMs: 300000,
    dataPath: dataPath,
  });

  // Configurações do Puppeteer
  let puppeteerConfig = {
    dataPath: dataPath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  };

  if (IS_SERVERLESS) {
    // Configuração SERVERLESS
    console.log("[CLIENT] Detectado ambiente Serverless. Usando @sparticuz/chromium.");
    if (!chromium) {
      throw new Error(
        "Ambiente serverless detectado, mas @sparticuz/chromium falhou ao carregar."
      );
    }
    
    // ===================================================================
    // ADICIONAMOS LOGS DE DEBUG AQUI
    // ===================================================================
    console.log("[CLIENT] 1/4: Buscando executablePath...");
    const execPath = await chromium.executablePath();
    if (!execPath) {
       throw new Error("Falha ao obter executablePath do Chromium.");
    }
    console.log(`[CLIENT] 2/4: Path encontrado.`); // Não logar o path, é muito longo

    puppeteerConfig.executablePath = execPath;
    puppeteerConfig.args = chromium.args;
    puppeteerConfig.defaultViewport = chromium.defaultViewport;
    puppeteerConfig.headless = chromium.headless; // Garante que estamos usando o 'new' do chromium

  } else {
    // Configuração LOCAL
    console.log(
      "[CLIENT] Detectado ambiente Local. Usando puppeteer-core/chrome local."
    );
    puppeteerConfig.headless = 'new'; // Padrão local
    puppeteerConfig.args.push(
       "--disable-accelerated-2d-canvas",
       "--no-first-run",
       "--no-zygote",
       "--disable-gpu"
     );
  }
  
  console.log("[CLIENT] 3/4: Configuração do Puppeteer finalizada. Criando Client...");

  const client = new Client({
    authStrategy: authStrategy,
    puppeteer: puppeteerConfig,
  });
  
  console.log("[CLIENT] 4/4: Client criado. Adicionando listeners...");

  // (Listeners)
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

  client.on("auth_failure", (msg) => {
    console.error(`[AUTH_FAILURE] Cliente ${id}:`, msg);
    creatingQr.delete(id);
  });

  client.on("disconnected", (reason) => {
    console.log(`[DISCONNECTED] Cliente ${id}:`, reason);
    qrCodes.delete(id);
    creatingQr.delete(id);
  });

  // Adicionando um listener de "carregando"
  client.on('loading_screen', (percent, message) => {
    console.log(`[CLIENT_LOADING] ${percent}% ${message}`);
  });

  client.on('error', (err) => {
    console.error(`[CLIENT_ERROR] Erro na instância do cliente:`, err);
  });

  console.log("[CLIENT] 5/5: Listeners adicionados. Chamando client.initialize()...");

  // (Inicialização)
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
const cron = require("node-cron");
const { Worker } = require('worker_threads');
const path = require('path');
const { captureException } = require('../../../utils/sentry');
// NOVO: Importar o logger do Discord
const { sendToDiscord } = require('../../../utils/discordLogger');

// A lógica de I/O pesado foi movida para este arquivo
const workerPath = path.resolve(__dirname, '../../../workers/scheduler-worker.js');

/**
 * Cria uma Worker Thread para executar a tarefa assíncrona pesada,
 * evitando bloquear o Event Loop do processo principal (onde a API e o cron rodam).
 * @param {string} taskName - Nome da função a ser executada no worker.
 */
const runTaskInWorker = (taskName) => {
    // NOVO: Log de início da tarefa
    console.log(`[SCHEDULER] Iniciando worker para a tarefa: ${taskName}`);
    sendToDiscord(`Iniciando worker para a tarefa: **${taskName}**`, 'info', taskName);
    
    const worker = new Worker(workerPath, {
        workerData: { taskName },
        resourceLimits: {
            maxOldGenerationSizeMb: 1024,
            maxYoungGenerationSizeMb: 16,
        }
    });

    worker.on('message', (msg) => {
        if (msg.status === 'error') {
            console.error(`[SCHEDULER] Worker Error for task ${msg.taskName}:`, msg.error);
            captureException(new Error(`Worker failed: ${msg.error}`), { tags: { severity: 'worker_general_failure', task: msg.taskName }});
            
            sendToDiscord(`Worker reportou um erro: \`\`\`${msg.error}\`\`\``, 'error', msg.taskName);
        
        } else if (msg.status === 'success') {
            // NOVO: Log de sucesso (reportado pelo worker) no Discord
            console.log(`[SCHEDULER] Worker task ${msg.taskName} concluída com sucesso.`);
            sendToDiscord(`Tarefa concluída com sucesso.`, 'success', msg.taskName);
        }
    });
    worker.on('error', (err) => {
        console.error(`[SCHEDULER] Worker Thread fatal error for task ${taskName}:`, err);
        captureException(err, { tags: { severity: 'worker_fatal_failure', task: taskName }});
        
        sendToDiscord(`Worker teve um erro FATAL: \`\`\`${err.message}\`\`\``, 'error', taskName);
    });
    worker.on('exit', (code) => {
        if (code !== 0) {
            console.error(`[SCHEDULER] Worker Thread for task ${taskName} stopped with exit code ${code}.`);
            
            sendToDiscord(`Worker parou inesperadamente com código de saída: **${code}**`, 'warn', taskName);
        }
    });
};
// ===================================================================
// INICIALIZAÇÃO DO CRON (Apenas chama a função Worker)
// ===================================================================
exports.startAutoMessageScheduler = () => {

    console.log("--- Iniciando Agendador de Mensagens Automáticas (em Worker Threads)... ---");

    // CRON JOB 1: A CADA MINUTO (Verifica lembretes de 1 minuto)
    cron.schedule("*/1 * * * *", () => {
      runTaskInWorker("APPOINTMENT_1_MIN_BEFORE");
    });

    // CRON JOB 2: DIÁRIO (Verifica lembretes de 1 e 2 dias e aniversários)
    // "0 1 * * *" = 1:00 AM UTC
    cron.schedule("0 1 * * *", () => {
      console.log("[CRON Diário] Iniciando tarefas diárias (aniversários, lembretes) no Worker...");
      // Disparamos Workers independentes para maximizar o paralelismo
      runTaskInWorker("APPOINTMENT_2_DAYS_BEFORE");
      runTaskInWorker("APPOINTMENT_1_DAY_BEFORE");
      runTaskInWorker("PATIENT_BIRTHDAY");

    }, {
        timezone: "UTC" // Especifica explicitamente que o horário é UTC
    });

    console.log("--- Agendador de Mensagens Automáticas Iniciado e Tarefas Agendadas. ---");
};
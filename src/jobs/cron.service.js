// src/jobs/cron.service.js
// (Substitua o conteúdo do seu auto-message.service.js por este)

const cron = require("node-cron");
const { captureException } = require("../utils/sentry");
const { sendToDiscord } = require("../utils/discordLogger");

// 1. Importa a função runTask do NOVO serviço
const { runTask } = require("./scheduler.service");

// 2. Remove toda a lógica de Worker (Worker, path, runTaskInWorker)

/**
 * Lida com erros das tarefas agendadas para evitar que o processo principal quebre
 * @param {Error} error O erro capturado
 * @param {string} taskName O nome da tarefa que falhou
 */
const handleTaskError = (error, taskName) => {
    console.error(
      `[SCHEDULER] Erro não tratado na tarefa agendada ${taskName}:`,
      error
    );
    captureException(error, {
      tags: { severity: "cron_task_unhandled", task: taskName },
    });
    sendToDiscord(
      `Erro fatal (unhandled) na tarefa ${taskName}: \`\`\`${error.message}\`\`\``,
      "error",
      taskName
    );
};

// ===================================================================
// INICIALIZAÇÃO DO CRON (Agora chama a função runTask diretamente)
// ===================================================================
exports.startAutoMessageScheduler = () => {
  console.log(
    "--- Iniciando Agendador de Mensagens Automáticas (In-Process)... ---"
  );

  // CRON JOB 1: A CADA MINUTO (Verifica lembretes de 3 minutos)
  cron.schedule("* * * * *", () => {
    console.log("[SCHEDULER] Executando tarefa: APPOINTMENT_3_MINS_BEFORE");
    sendToDiscord("Iniciando tarefa: **APPOINTMENT_3_MINS_BEFORE**", "info", "APPOINTMENT_3_MINS_BEFORE");

    // Chama a função diretamente e anexa um .catch()
    runTask("APPOINTMENT_3_MINS_BEFORE").catch(err => {
        handleTaskError(err, "APPOINTMENT_3_MINS_BEFORE");
    });
  });

  // CRON JOB 2: DIÁRIO (Verifica lembretes de 1 e 2 dias e aniversários)
  // "0 1 * * *" = 1:00 AM UTC
  cron.schedule(
    "0 1 * * *", // 1h da manhã UTC (22h no Brasil - Horário de Brasília)
    () => {
      console.log(
        "[CRON Diário] Iniciando tarefas diárias (aniversários, lembretes)..."
      );

      // Executamos as tarefas em sequência para não sobrecarregar
      // ou podemos dispará-las em paralelo se forem independentes
      
      // Abordagem em paralelo (preferida):
      const tasks = ["APPOINTMENT_2_DAYS_BEFORE", "APPOINTMENT_1_DAY_BEFORE", "PATIENT_BIRTHDAY"];
      
      tasks.forEach(taskName => {
        console.log(`[SCHEDULER] Executando tarefa: ${taskName}`);
        sendToDiscord(`Iniciando tarefa: **${taskName}**`, "info", taskName);
        
        runTask(taskName).catch(err => {
            handleTaskError(err, taskName);
        });
      });
    },
    {
      timezone: "UTC",  
    }
  );

  console.log(
    "--- Agendador de Mensagens Automáticas Iniciado e Tarefas Agendadas. ---"
  );
};
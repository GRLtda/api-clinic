

const { runTask } = require("../src/jobs/scheduler.service");
const { sendToDiscord } = require("../src/utils/discordLogger");

async function runRemindersSweep() {
  const shimTaskGroup = "REMINDERS_SWEEP_SHIM";
  const tasks = [
    "APPOINTMENT_1_DAY_BEFORE",
    "APPOINTMENT_2_DAYS_BEFORE",
    // Se no futuro criar APPOINTMENT_2_HOURS_BEFORE no scheduler, adicione aqui.
    // "APPOINTMENT_2_HOURS_BEFORE",
  ];

  try {
    sendToDiscord(
      `Iniciando runRemindersSweep (shim) → ${tasks.join(", ")}`,
      "info",
      shimTaskGroup
    );

    await Promise.all(
      tasks.map((taskName) =>
        runTask(taskName).catch((err) => {
          sendToDiscord(
            `Erro executando ${taskName}: \`${(err && err.message) || "erro desconhecido"}\``,
            "error",
            taskName
          );
        })
      )
    );

    sendToDiscord(
      `runRemindersSweep (shim) concluído: ${tasks.join(", ")}`,
      "success",
      shimTaskGroup
    );
  } catch (err) {
    sendToDiscord(
      `Falha inesperada em runRemindersSweep (shim): \`${(err && err.message) || "erro desconhecido"}\``,
      "error",
      shimTaskGroup
    );
    // Não propaga, para não quebrar chamadores legados que não fazem try/catch
  }
}

module.exports = { runRemindersSweep };
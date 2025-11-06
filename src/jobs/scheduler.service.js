// src/jobs/scheduler.service.js
// -----------------------------------------------------------------------------
const mongoose = require("mongoose");

// --- IMPORTAÇÃO DOS MODELS ---
const Patient = require("../api/patients/patients.model");
const Clinic = require("../api/clinics/clinics.model");
const User = require("../api/users/users.model");
const MessageTemplate = require("../api/crm/modelos/message-template.model");
const MessageSetting = require("../api/crm/message-settings.model");
const Appointment = require("../api/appointments/appointments.model");
const {
  MessageLog,
  LOG_STATUS,
  ACTION_TYPES,
} = require("../api/crm/logs/message-log.model");
// --- FIM DOS MODELS ---

// Dependências
const whatsappServiceClient = require("../services/whatsappServiceClient");
const { createLogEntry } = require("../api/crm/logs/message-log.controller");
const { captureException } = require("../utils/sentry");
const { DateTime } = require("luxon");
const { sendToDiscord } = require("../utils/discordLogger");
const {
  computeOffsetWindowUtc,
  formatForPatient,
  DEFAULT_TZ,
  DEFAULT_WINDOW_MINUTES,
} = require("./reminderWindow");

// --- p-limit (carregado sob demanda, com garantia) ---
let pLimit;
async function ensurePLimit(taskName) {
  if (pLimit) return pLimit;
  try {
    const mod = await import("p-limit");
    pLimit = mod.default;
    return pLimit;
  } catch (err) {
    captureException(err, {
      tags: { severity: "critical", context: "p-limit-load", workerTask: taskName },
    });
    console.error(`[SCHEDULER SERVICE] Falha crítica ao carregar p-limit.`);
    throw new Error("Falha ao carregar p-limit.");
  }
}

// --- Mapeamento de offsets por tarefa ---
const TASK_OFFSETS_MIN = {
  APPOINTMENT_3_MINS_BEFORE: 3,
  APPOINTMENT_1_DAY_BEFORE: 1440,
  APPOINTMENT_2_HOURS_BEFORE: 120,
};

// --- Tarefa -> flag correspondente no Appointment.remindersSent ---
const TASK_TO_FLAG = {
  APPOINTMENT_3_MINS_BEFORE: "remindersSent.threeMinutesBefore",
  APPOINTMENT_1_DAY_BEFORE: "remindersSent.oneDayBefore",
  APPOINTMENT_2_HOURS_BEFORE: "remindersSent.twoHoursBefore",
};

// --- Funções auxiliares ---
const fillTemplate = (templateContent, data) => {
  let content = templateContent || "";
  content = content.replace(/{ ?paciente ?}/g, data.patientName || "Paciente");
  content = content.replace(/{ ?clinica ?}/g, data.clinicName || "Clínica");
  content = content.replace(/{ ?nome_medico ?}/g, data.doctorName || "Dr(a).");
  content = content.replace(/{ ?data_consulta ?}/g, data.appointmentDate || "");
  content = content.replace(/{ ?hora_consulta ?}/g, data.appointmentTime || "");
  content = content.replace(/{ ?link_anamnese ?}/g, data.anamnesisLink || "");
  return content.trim();
};

// --- Envio e log (NUNCA grava null em wwebjsMessageId) ---
const trySendMessageAndLog = async (
  taskName,
  {
    clinicId,
    patientId,
    appointmentId,
    recipientPhone,
    finalMessage,
    settingType,
    templateId,
    clinicName,
  }
) => {
  if (!clinicId || !patientId || !recipientPhone || !finalMessage || !settingType) {
    console.warn(`[SCHEDULER ${taskName}] Dados insuficientes para envio/log.`);
    sendToDiscord(`Dados insuficientes para enviar ${settingType} para ${recipientPhone}`, "warn", taskName);
    return;
  }

  const formattedPhone = recipientPhone.replace(/\D/g, "");
  let logEntry;

  try {
    logEntry = await createLogEntry({
      clinic: clinicId,
      patient: patientId,
      appointment: appointmentId || undefined,
      template: templateId,
      settingType,
      messageContent: finalMessage,
      recipientPhone: formattedPhone,
      status: LOG_STATUS.SENT_ATTEMPT,
      actionType:
        settingType === "PATIENT_BIRTHDAY"
          ? ACTION_TYPES.AUTOMATIC_BIRTHDAY
          : ACTION_TYPES.AUTOMATIC_REMINDER,
    });

    if (!logEntry) throw new Error("Falha ao criar log inicial.");

    console.log(
      `[SCHEDULER ${taskName}] Enviando ${settingType} para ${formattedPhone} (${clinicName})`
    );

    const response = await whatsappServiceClient.sendMessage(
      clinicId,
      formattedPhone,
      finalMessage
    );

    const wId = response?.data?.result?.id?.id;

    if (wId) {
      await MessageLog.findByIdAndUpdate(
        logEntry._id,
        { $set: { status: LOG_STATUS.DELIVERED, wwebjsMessageId: wId } }
      );
    } else {
      // não persistir null — remove o campo se existir
      await MessageLog.findByIdAndUpdate(
        logEntry._id,
        { status: LOG_STATUS.DELIVERED, $unset: { wwebjsMessageId: "" } }
      );
    }

    sendToDiscord(
      `Mensagem automática (${settingType}) enviada com sucesso para ${formattedPhone}`,
      "success",
      taskName,
      `Clínica: ${clinicName || clinicId} | Log ID: ${logEntry._id}`
    );
  } catch (error) {
    const errMsg =
      error?.response?.data?.message || error?.message || "Erro desconhecido.";
    const logId = logEntry?._id?.toString() || "N/A";

    console.error(
      `[SCHEDULER ${taskName}] Falha ao enviar ${settingType} para ${formattedPhone}. Erro: ${errMsg}`
    );
    captureException(error, {
      tags: {
        severity: "whatsapp_automatic_failure",
        clinic_id: clinicId?.toString?.() || String(clinicId),
        setting_type: settingType,
        context: "schedulerServiceSend",
        workerTask: taskName,
      },
      extra: { patient_id: patientId?.toString?.() || String(patientId), phone: recipientPhone, log_id: logId },
    });

    if (logEntry) {
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.ERROR_SYSTEM,
        errorMessage: `Erro (Scheduler ${taskName}): ${String(errMsg).substring(0, 500)}`,
      }).catch((e) => {
        captureException(e, {
          tags: { severity: "scheduler_log_update_failure", workerTask: taskName },
        });
      });
    }

    sendToDiscord(
      `Falha ao enviar (${settingType}) para ${formattedPhone}\n**Erro:** ${String(errMsg).substring(0, 1000)}`,
      "error",
      taskName,
      `Clínica: ${clinicName || clinicId} | Log ID: ${logId}`
    );
  }
};

// --- Lembretes por offset (lógica unificada com LOCK atômico) ---
const checkAndSendAppointmentReminders = async (taskName) => {
  const type = taskName;
  const offsetMinutes = TASK_OFFSETS_MIN[type];
  const flagPath = TASK_TO_FLAG[type];

  if (typeof offsetMinutes !== "number" || !flagPath) {
    console.warn(`[SCHEDULER ${taskName}] Task sem offset/flag conhecido.`);
    sendToDiscord(`Task sem offset/flag mapeado: ${type}`, "warn", taskName);
    return;
  }

  const limit = (await ensurePLimit(taskName))(5);
  const nowUtc = DateTime.utc();
  const { startUtc, endUtc } = computeOffsetWindowUtc({
    nowUtc,
    offsetMinutes,
    windowMinutes: DEFAULT_WINDOW_MINUTES,
  });

  console.log(`[SCHEDULER ${taskName}] Janela alvo UTC: ${startUtc.toISOString()} → ${endUtc.toISOString()}`);

  const activeSettings = await MessageSetting.find({ type, isActive: true })
    .select("clinic template")
    .populate({ path: "template", select: "content" })
    .populate({
      path: "clinic",
      select: "name owner",
      populate: { path: "owner", select: "name" },
    })
    .lean();

  if (!activeSettings?.length) {
    console.log(`[SCHEDULER ${taskName}] Nenhuma configuração ativa para ${type}.`);
    return;
  }

  const settingProcessing = activeSettings.map(async (setting) => {
    if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.owner?.name) {
      console.warn(`[SCHEDULER ${taskName}] Configuração inválida ignorada.`);
      sendToDiscord(`Config inválida/incompleta ignorada para ${type}`, "warn", taskName);
      return;
    }

    const { _id: clinicId, name: clinicName, owner } = setting.clinic;
    const doctorName = owner.name;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    // Busca só o que ainda não teve ESTE lembrete enviado
    const appointments = await Appointment.find({
      clinic: clinicId,
      startTime: { $gte: startUtc, $lte: endUtc },
      status: { $in: ["Agendado", "Confirmado"] },
      sendReminder: true,
      [flagPath]: { $ne: true },
    })
      .select("patient startTime _id remindersSent")
      .populate({ path: "patient", select: "name phone _id" })
      .lean();

    if (!appointments?.length) return;

    console.log(`[SCHEDULER ${taskName}] ${appointments.length} agendamentos em ${clinicName}.`);

    const sendTasks = appointments.map((appt) => {
      if (!appt.patient?._id || !appt.patient.phone) {
        console.warn(`[SCHEDULER ${taskName}] Appt ${appt._id} sem dados do paciente.`);
        return Promise.resolve();
      }

      const { date, time } = formatForPatient(appt.startTime, DEFAULT_TZ);
      const finalMessage = fillTemplate(templateContent, {
        patientName: appt.patient.name,
        clinicName,
        doctorName,
        appointmentDate: date,
        appointmentTime: time,
        anamnesisLink: "",
      });

      return limit(async () => {
        // LOCK atômico: marca a flag antes de enviar
        const locked = await Appointment.findOneAndUpdate(
          { _id: appt._id, [flagPath]: { $ne: true } },
          { $set: { [flagPath]: true } },
          { new: true }
        ).lean();

        if (!locked) {
          // outro worker/execução já marcou: evita duplicidade
          return;
        }

        await trySendMessageAndLog(taskName, {
          clinicId,
          patientId: appt.patient._id,
          appointmentId: appt._id,
          recipientPhone: appt.patient.phone,
          finalMessage,
          settingType: type,
          templateId,
          clinicName,
        });
      });
    });

    await Promise.all(sendTasks);
  });

  await Promise.all(settingProcessing);
  console.log(`[SCHEDULER ${taskName}] Concluído.`);
};

// --- Aniversários (mantido, com p-limit garantido) ---
const checkAndSendBirthdayWishes = async (taskName) => {
  const type = "PATIENT_BIRTHDAY";

  const limit = (await ensurePLimit(taskName))(10);

  const today = new Date();
  const todayLocal = new Date(today.toLocaleString("en-US", { timeZone: DEFAULT_TZ }));
  const todayDay = todayLocal.getDate();
  const todayMonth = todayLocal.getMonth() + 1;
  const startOfDayLocal = new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate());
  const startOfDayUTC = new Date(Date.UTC(startOfDayLocal.getFullYear(), startOfDayLocal.getMonth(), startOfDayLocal.getDate()));

  console.log(`[SCHEDULER ${taskName}] Verificando aniversariantes ${todayDay}/${todayMonth}.`);

  const activeSettings = await MessageSetting.find({ type, isActive: true })
    .select("clinic template")
    .populate("template", "content")
    .populate({
      path: "clinic",
      select: "name owner",
      populate: { path: "owner", select: "name" },
    })
    .lean();

  if (!activeSettings?.length) {
    console.log(`[SCHEDULER ${taskName}] Nenhuma configuração ativa para ${type}.`);
    return;
  }

  const settingProcessing = activeSettings.map(async (setting) => {
    if (!setting.template?.content || !setting.clinic?._id || !setting.clinic.owner?.name) {
      sendToDiscord(`Config de aniversário inválida ignorada`, "warn", taskName);
      return;
    }

    const clinicId = setting.clinic._id;
    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner.name;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    const birthdayPatients = await Patient.find({
      clinicId,
      $expr: {
        $and: [
          { $eq: [{ $dayOfMonth: { date: "$birthDate", timezone: DEFAULT_TZ } }, todayDay] },
          { $eq: [{ $month: { date: "$birthDate", timezone: DEFAULT_TZ } }, todayMonth] },
        ],
      },
      deletedAt: { $exists: false },
    })
      .select("_id name phone")
      .lean();

    if (!birthdayPatients?.length) return;

    const sendTasks = birthdayPatients.map(async (p) => {
      if (!p.phone) return;

      const alreadySent = await MessageLog.exists({
        clinic: clinicId,
        patient: p._id,
        settingType: type,
        actionType: ACTION_TYPES.AUTOMATIC_BIRTHDAY,
        status: { $in: [LOG_STATUS.SENT_ATTEMPT, LOG_STATUS.DELIVERED, LOG_STATUS.READ] },
        createdAt: { $gte: startOfDayUTC },
      });
      if (alreadySent) return;

      const finalMessage = fillTemplate(templateContent, {
        patientName: p.name,
        clinicName,
        doctorName,
      });

      return limit(() =>
        trySendMessageAndLog(taskName, {
          clinicId,
          patientId: p._id,
          appointmentId: undefined, // não aplicável para aniversário
          recipientPhone: p.phone,
          finalMessage,
          settingType: type,
          templateId,
          clinicName,
        })
      );
    });
    await Promise.all(sendTasks);
  });

  await Promise.all(settingProcessing);
  console.log(`[SCHEDULER ${taskName}] Processamento de aniversários concluído.`);
};

// --- Função principal ---
exports.runTask = async (taskName) => {
  // garante p-limit carregado
  await ensurePLimit(taskName);

  try {
    console.log(`[SCHEDULER ${taskName}] Iniciando execução.`);
    switch (taskName) {
      case "APPOINTMENT_3_MINS_BEFORE":
      case "APPOINTMENT_1_DAY_BEFORE":
      case "APPOINTMENT_2_HOURS_BEFORE":
        await checkAndSendAppointmentReminders(taskName);
        break;
      case "PATIENT_BIRTHDAY":
        await checkAndSendBirthdayWishes(taskName);
        break;
      default:
        console.warn(`[SCHEDULER ${taskName}] Tarefa desconhecida.`);
        sendToDiscord(`Tarefa desconhecida recebida: ${taskName}`, "warn", taskName);
        break;
    }
    console.log(`[SCHEDULER ${taskName}] Concluída.`);
  } catch (error) {
    console.error(`[SCHEDULER ${taskName}] Erro:`, error.message);
    captureException(error, {
      tags: { severity: "scheduler_task_failure", task: taskName, context: "runTaskService" },
    });
    sendToDiscord(`Erro durante execução: ${error.message}`, "error", taskName);
    throw error;
  }
};

const mongoose = require('mongoose'); // <-- ADICIONE ESTA LINHA
const { parentPort, workerData } = require("worker_threads");
const MessageSetting = require("../api/crm/message-settings.model");
const Appointment = require("../api/appointments/appointments.model");
const Patient = require("../api/patients/patients.model");
const whatsappServiceClient = require("../services/whatsappServiceClient");
const { createLogEntry } = require("../api/crm/logs/message-log.controller");
const {
  MessageLog,
  LOG_STATUS,
  ACTION_TYPES,
} = require("../api/crm/logs/message-log.model");
const { captureException } = require("../utils/sentry");
const { DateTime } = require("luxon");
const axios = require("axios");

let pLimit;
(async () => {
  const module = await import("p-limit");
  pLimit = module.default;
})().catch((err) => {
  captureException(err, {
    tags: { severity: "critical", context: "p-limit-worker-load" },
  });
  process.exit(1);
});

const BR_TZ = "America/Sao_Paulo";
const WINDOW_MINUTES = 2;

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

const formatDate = (date) => {
  if (!date) return "";
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return "";
  return dateObj.toLocaleDateString("pt-BR", { timeZone: BR_TZ });
};

const formatTime = (date) => {
  if (!date) return "";
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return "";
  return dateObj.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BR_TZ,
  });
};

const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1432810373244915732/OapA83WGKuWf1rlxbtQGFPkwD_H4K9mIxtO8BaIKrO1ZVyT5u5UNyKLVi_U0u0Ce41D1";

const sendDiscordNotification = (color, title, fields, footer) => {
  if (!DISCORD_WEBHOOK_URL) return;

  const payload = {
    username: "CRM Scheduler Bot",
    embeds: [
      {
        color: color,
        title: title,
        timestamp: new Date().toISOString(),
        fields: fields,
        footer: footer ? { text: footer } : undefined,
      },
    ],
  };

  axios
    .post(DISCORD_WEBHOOK_URL, payload)
    .catch((err) =>
      captureException(err, {
        tags: {
          severity: "discord_webhook_failure",
          context: "sendDiscordNotification",
        },
      })
    );
};

const trySendMessageAndLog = async ({
  clinicId,
  patientId,
  recipientPhone,
  finalMessage,
  settingType,
  templateId,
  clinicName,
}) => {
  if (
    !clinicId ||
    !patientId ||
    !recipientPhone ||
    !finalMessage ||
    !settingType
  ) {
    return;
  }

  const formattedPhone = recipientPhone.replace(/\D/g, "");

  let logEntry;
  let notificationTitle;
  let notificationColor;
  let notificationFields = [];

  try {
    logEntry = await createLogEntry({
      clinic: clinicId,
      patient: patientId,
      template: templateId,
      settingType: settingType,
      messageContent: finalMessage,
      recipientPhone: formattedPhone,
      status: LOG_STATUS.SENT_ATTEMPT,
      actionType:
        settingType === "PATIENT_BIRTHDAY"
          ? ACTION_TYPES.AUTOMATIC_BIRTHDAY
          : ACTION_TYPES.AUTOMATIC_REMINDER,
    });

    if (!logEntry) throw new Error("Falha ao criar entrada de log inicial.");

    const response = await whatsappServiceClient.sendMessage(
      clinicId,
      formattedPhone,
      finalMessage
    );

    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: LOG_STATUS.DELIVERED,
      wwebjsMessageId: response.data?.result?.id?.id || null,
    });

    notificationTitle = `✅ Sucesso: Mensagem Automática Enviada (${settingType})`;
    notificationColor = 3066993;
    notificationFields = [
      {
        name: "Clínica",
        value: clinicName || clinicId.toString(),
        inline: true,
      },
      { name: "Tipo", value: settingType, inline: true },
      { name: "Telefone", value: formattedPhone, inline: true },
      { name: "Log ID", value: logEntry._id.toString(), inline: false },
    ];

    sendDiscordNotification(
      notificationColor,
      notificationTitle,
      notificationFields,
      `Status: ${LOG_STATUS.DELIVERED}`
    );
  } catch (error) {
    const errorMessage =
      error.response?.data?.message ||
      error.message ||
      "Erro desconhecido ao contatar serviço WhatsApp.";
    captureException(error, {
      tags: {
        severity: "whatsapp_automatic_failure",
        clinic_id: clinicId.toString(),
        setting_type: settingType,
        context: "workerServiceSend",
      },
      extra: {
        patient_id: patientId.toString(),
        phone: recipientPhone,
        log_id: logEntry?._id?.toString() || "N/A",
        error_details: error.response?.data || errorMessage,
      },
    });

    if (logEntry) {
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.ERROR_SYSTEM,
        errorMessage: `Erro via serviço (Worker): ${errorMessage}`,
      }).catch((logUpdateError) => {
        captureException(logUpdateError, {
          tags: { severity: "worker_log_update_failure" },
        });
      });
    }

    const logId = logEntry?._id?.toString() || "N/A";
    notificationTitle = `❌ ERRO: Falha no Envio Automático (${settingType})`;
    notificationColor = 15158332;
    notificationFields = [
      {
        name: "Clínica",
        value: clinicName || clinicId.toString(),
        inline: true,
      },
      { name: "Tipo", value: settingType, inline: true },
      { name: "Telefone", value: formattedPhone, inline: true },
      { name: "Erro", value: errorMessage, inline: false },
      { name: "Log ID", value: logId, inline: false },
    ];

    sendDiscordNotification(
      notificationColor,
      notificationTitle,
      notificationFields,
      `Status: ${LOG_STATUS.ERROR_SYSTEM}`
    );
  }
};

const checkAndSendAppointmentReminders = async (type, daysOffset) => {
  if (!pLimit) return;
  const limit = pLimit(5);
  const nowUtc = DateTime.utc();

  let targetStartUtc, targetEndUtc;
  if (daysOffset > 0) {
    targetStartUtc = nowUtc
      .plus({ days: daysOffset })
      .setZone(BR_TZ)
      .startOf("day")
      .toUTC();
    targetEndUtc = nowUtc
      .plus({ days: daysOffset })
      .setZone(BR_TZ)
      .endOf("day")
      .toUTC();
    } else if (type === 'APPOINTMENT_3_MINS_BEFORE') {
        targetStartUtc = nowUtc.plus({ minutes: 3 });
        targetEndUtc = nowUtc.plus({ minutes: 4 });
    } else {
    return;
  }

  const targetStartDate = targetStartUtc.toJSDate();
  const targetEndDate = targetEndUtc.toJSDate();

  const activeSettings = await MessageSetting.find({
    type: type,
    isActive: true,
  })
    .select("clinic template")
    .populate({ path: "template", select: "content" })
    .populate({
      path: "clinic",
      select: "name owner",
      populate: { path: "owner", select: "name" },
    })
    .lean();

  if (!activeSettings || activeSettings.length === 0) return;

  const settingProcessingPromises = activeSettings.map(async (setting) => {
    if (
      !setting.template?.content ||
      !setting.clinic?._id ||
      !setting.clinic.owner?.name
    )
      return;

    const { _id: clinicId, name: clinicName, owner } = setting.clinic;
    const doctorName = owner.name;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    const appointments = await Appointment.find({
      clinic: clinicId,
      startTime: { $gte: targetStartDate, $lte: targetEndDate },
      status: { $in: ["Agendado", "Confirmado"] },
      sendReminder: true,
    })
      .select("patient startTime")
      .populate({ path: "patient", select: "name phone" })
      .lean();

    if (!appointments || appointments.length === 0) return;

    const sendTasks = appointments.map((appointment) => {
      if (!appointment.patient?._id || !appointment.patient.phone)
        return Promise.resolve();

      const finalMessage = fillTemplate(templateContent, {
        patientName: appointment.patient.name,
        clinicName: clinicName,
        doctorName: doctorName,
        appointmentDate: formatDate(appointment.startTime),
        appointmentTime: formatTime(appointment.startTime),
        anamnesisLink: "",
      });

      return limit(() =>
        trySendMessageAndLog({
          clinicId: clinicId,
          patientId: appointment.patient._id,
          recipientPhone: appointment.patient.phone,
          finalMessage: finalMessage,
          settingType: type,
          templateId: templateId,
          clinicName: clinicName,
        })
      );
    });

    await Promise.all(sendTasks);
  });

  await Promise.all(settingProcessingPromises);
};

const checkAndSendBirthdayWishes = async () => {
  if (!pLimit) return;
  const limit = pLimit(10);
  const type = "PATIENT_BIRTHDAY";
  const activeSettings = await MessageSetting.find({
    type: type,
    isActive: true,
  })
    .select("clinic template")
    .populate("template", "content")
    .populate({
      path: "clinic",
      select: "name owner",
      populate: { path: "owner", select: "name" },
    })
    .lean();

  if (!activeSettings || activeSettings.length === 0) return;

  const today = new Date();
  const todayLocal = new Date(
    today.toLocaleString("en-US", { timeZone: BR_TZ })
  );
  const todayDay = todayLocal.getDate();
  const todayMonth = todayLocal.getMonth() + 1;
  const startOfDayLocal = new Date(
    todayLocal.getFullYear(),
    todayLocal.getMonth(),
    todayLocal.getDate()
  );
  const startOfDayUTC = new Date(
    Date.UTC(
      startOfDayLocal.getFullYear(),
      startOfDayLocal.getMonth(),
      startOfDayLocal.getDate()
    )
  );

  const settingProcessingPromises = activeSettings.map(async (setting) => {
    if (
      !setting.template?.content ||
      !setting.clinic?._id ||
      !setting.clinic.owner?.name
    )
      return;

    const clinicId = setting.clinic._id;
    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner.name;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    const birthdayPatients = await Patient.find({
      clinicId: clinicId,
      $expr: {
        $and: [
          {
            $eq: [
              { $dayOfMonth: { date: "$birthDate", timezone: BR_TZ } },
              todayDay,
            ],
          },
          {
            $eq: [
              { $month: { date: "$birthDate", timezone: BR_TZ } },
              todayMonth,
            ],
          },
        ],
      },
      deletedAt: { $exists: false },
    })
      .select("_id name phone")
      .lean();

    if (!birthdayPatients || birthdayPatients.length === 0) return;

    const sendTasks = birthdayPatients.map(async (patientData) => {
      if (!patientData.phone) return Promise.resolve();

      const alreadySentToday = await MessageLog.exists({
        clinic: clinicId,
        patient: patientData._id,
        settingType: type,
        actionType: ACTION_TYPES.AUTOMATIC_BIRTHDAY,
        status: {
          $in: [LOG_STATUS.SENT_ATTEMPT, LOG_STATUS.DELIVERED, LOG_STATUS.READ],
        },
        createdAt: { $gte: startOfDayUTC },
      });

      if (alreadySentToday) return Promise.resolve();

      const finalMessage = fillTemplate(templateContent, {
        patientName: patientData.name,
        clinicName: clinicName,
        doctorName: doctorName,
      });

      return limit(() =>
        trySendMessageAndLog({
          clinicId: clinicId,
          patientId: patientData._id,
          recipientPhone: patientData.phone,
          finalMessage: finalMessage,
          settingType: type,
          templateId: templateId,
          clinicName: clinicName,
        })
      );
    });
    await Promise.all(sendTasks);
  });

  await Promise.all(settingProcessingPromises);
};

const runTask = async (taskName, ...args) => {
    if (mongoose.connection.readyState !== 1) {
        console.error(`[SCHEDULER WORKER ${taskName}] Conexão MongoDB não pronta (readyState: ${mongoose.connection.readyState}). Abortando.`);
        sendDiscordNotification(15105570, `⚠️ Worker Abortado (${taskName})`, [{ name: 'Motivo', value: 'Conexão DB não pronta' }], `readyState: ${mongoose.connection.readyState}`);
        parentPort.postMessage({ status: 'error', taskName, error: 'MongoDB connection not ready' });
        return;
    }
  await new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (pLimit) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });

  try {
    switch (taskName) {
      case "APPOINTMENT_3_MINS_BEFORE":
        await checkAndSendAppointmentReminders(taskName, 0);
        break;
      case "APPOINTMENT_2_DAYS_BEFORE":
        await checkAndSendAppointmentReminders(taskName, 2);
        break;
      case "APPOINTMENT_1_DAY_BEFORE":
        await checkAndSendAppointmentReminders(taskName, 1);
        break;
      case "PATIENT_BIRTHDAY":
        await checkAndSendBirthdayWishes();
        break;
      default:
        break;
    }
    parentPort.postMessage({ status: "done", taskName });
  } catch (error) {
    captureException(error, {
      tags: { severity: "worker_task_failure", task: taskName },
    });
    parentPort.postMessage({ status: "error", taskName, error: error.message });
  }
};

if (workerData?.taskName) {
  runTask(workerData.taskName, ...(workerData.args || []));
}

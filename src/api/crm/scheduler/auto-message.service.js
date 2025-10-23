// src/api/crm/scheduler/auto-message.service.js
const cron = require("node-cron");
const MessageSetting = require("../message-settings.model");
const MessageTemplate = require("../modelos/message-template.model");
const Appointment = require("../../appointments/appointments.model");
const Patient = require("../../patients/patients.model");
const { initializeClient, sendMessage } = require("../conexao/whatsapp.client");
const { createLogEntry } = require("../logs/message-log.controller");
const {
  MessageLog,
  LOG_STATUS,
  ACTION_TYPES,
} = require("../logs/message-log.model");
const { formatPhoneNumber } = require("../utils/phone-formatter");

// ===================================================================
// UTILS DE FORMATAÇÃO E PREENCHIMENTO
// ===================================================================

/**
 * Preenche o template com os dados dinâmicos.
 */
const fillTemplate = (templateContent, data) => {
  let content = templateContent;

  // Variáveis do paciente/clínica (sempre disponíveis)
  content = content.replace(/{ paciente }/g, data.patientName || "Paciente");
  content = content.replace(/{ clinica }/g, data.clinicName || "Clínica");
  content = content.replace(/{ nome_medico }/g, data.doctorName || "Dr(a).");

  // Variáveis da consulta (se existirem)
  content = content.replace(/{ data_consulta }/g, data.appointmentDate || "");
  content = content.replace(/{ hora_consulta }/g, data.appointmentTime || "");

  // Por enquanto, remove a variável de anamnese se não for fornecida (futura implementação)
  content = content.replace(/{ link_anamnese }/g, data.anamnesisLink || "");

  return content.trim();
};

/**
 * Formata um objeto Date para a string de data (dd/mm/aaaa)
 */
const formatDate = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleDateString("pt-BR");
};

/**
 * Formata um objeto Date para a string de hora (hh:mm)
 */
const formatTime = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

// ===================================================================
// FUNÇÃO CENTRAL DE ENVIO (COM LÓGICA DE CONEXÃO E LOG)
// ===================================================================

const trySendMessageAndLog = async ({
  clinicId,
  patientId,
  recipientPhone,
  finalMessage,
  settingType,
  templateId,
}) => {
  // Formata o número de telefone com prefixo 55 do Brasil
  const formattedPhone = formatPhoneNumber(recipientPhone);

  // 1. Cria o log de tentativa
  let logEntry = await createLogEntry({
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

  try {
    // 2. Tenta inicializar/restaurar o cliente (CRÍTICO)
    const client = await initializeClient(clinicId);

    // Se a instância estiver pronta, mas ainda no estágio de QR Code (sem conexão)
    if (client.qrCode) {
      throw new Error(
        `Cliente WhatsApp da clínica ${clinicId} não está conectado (Aguardando QR Code).`
      );
    }

    // 3. Tenta enviar a mensagem
    const result = await sendMessage(clinicId, formattedPhone, finalMessage);

    // 4. Atualiza o log com o sucesso
    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: LOG_STATUS.DELIVERED,
      wwebjsMessageId: result.id.id,
    });

    console.log(
      `[${settingType}] Mensagem enviada para ${formattedPhone}. Log ID: ${logEntry._id}`
    );
  } catch (error) {
    // 5. Atualiza o log com o erro
    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: LOG_STATUS.ERROR_WHATSAPP,
      errorMessage: error.message,
    });
    console.error(
      `[${settingType}] ERRO ao enviar mensagem para ${formattedPhone}: ${error.message}`
    );
  }
};

// ===================================================================
// LÓGICA DE LEMBRETES DE CONSULTA
// ===================================================================

const checkAndSendAppointmentReminders = async (type, daysOffset) => {
  console.log(`[SCHEDULER] Iniciando verificação de ${type}...`);

  // 1. Encontra TODAS as configurações ativas para o TIPO
  const activeSettings = await MessageSetting.find({
    type: type,
    isActive: true,
  })
    .populate("template")
    // Popula clínica e o dono (médico) da clínica
    .populate({
      path: "clinic",
      select: "name owner",
      populate: {
        path: "owner",
        select: "name",
      },
    });

  if (activeSettings.length === 0) return;

  for (const setting of activeSettings) {
    const clinicId = setting.clinic._id;
    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner.name;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    const now = new Date();
    let targetStart = new Date(now);
    let targetEnd = new Date(now);

    // Define o intervalo de tempo para a busca
    if (daysOffset > 0) {
      // Gatilhos de 1 ou 2 dias antes
      targetStart.setDate(now.getDate() + daysOffset);
      targetEnd.setDate(targetStart.getDate());
      targetStart.setHours(0, 0, 0, 0);
      targetEnd.setHours(23, 59, 59, 999);
    } else {
      // Gatilho APPOINTMENT_1_MIN_BEFORE (próximos 5 minutos)
      targetStart = new Date(now.getTime() - 1 * 60 * 1000); // Começa 1 minuto atrás
      targetEnd = new Date(now.getTime() + 4 * 60 * 1000); // Termina 4 minutos à frente
    }

    // Busca agendamentos relevantes
    const appointments = await Appointment.find({
      clinic: clinicId,
      startTime: {
        $gte: targetStart,
        $lte: targetEnd,
      },
      status: { $in: ["Agendado", "Confirmado"] },
    }).populate("patient", "name phone");

    for (const appointment of appointments) {
      const patientData = appointment.patient;

      const finalMessage = fillTemplate(templateContent, {
        patientName: patientData.name,
        clinicName: clinicName,
        doctorName: doctorName,
        appointmentDate: formatDate(appointment.startTime),
        appointmentTime: formatTime(appointment.startTime),
      });

      await trySendMessageAndLog({
        clinicId: clinicId,
        patientId: patientData._id,
        recipientPhone: patientData.phone,
        finalMessage: finalMessage,
        settingType: type,
        templateId: templateId,
      });
    }
  }
  console.log(`[SCHEDULER] Finalizado verificação de ${type}.`);
};

// ===================================================================
// LÓGICA DE ANIVERSÁRIO
// ===================================================================

const checkAndSendBirthdayWishes = async () => {
  const type = "PATIENT_BIRTHDAY";
  console.log(`[SCHEDULER] Iniciando verificação de ${type}...`);

  const activeSettings = await MessageSetting.find({
    type: type,
    isActive: true,
  })
    .populate("template")
    .populate({
      path: "clinic",
      select: "name owner",
      populate: { path: "owner", select: "name" },
    });

  if (activeSettings.length === 0) return;

  for (const setting of activeSettings) {
    const clinicId = setting.clinic._id;
    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner.name;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    const today = new Date();
    const todayDay = today.getDate();
    const todayMonth = today.getMonth() + 1;

    // Busca pacientes que fazem aniversário HOJE
    const birthdayPatients = await Patient.find({
      clinicId: clinicId,
      $expr: {
        $and: [
          { $eq: [{ $dayOfMonth: "$birthDate" }, todayDay] },
          { $eq: [{ $month: "$birthDate" }, todayMonth] },
        ],
      },
    });

    for (const patientData of birthdayPatients) {
      const finalMessage = fillTemplate(templateContent, {
        patientName: patientData.name,
        clinicName: clinicName,
        doctorName: doctorName,
      });

      await trySendMessageAndLog({
        clinicId: clinicId,
        patientId: patientData._id,
        recipientPhone: patientData.phone,
        finalMessage: finalMessage,
        settingType: type,
        templateId: templateId,
      });
    }
  }
  console.log(`[SCHEDULER] Finalizado verificação de ${type}.`);
};

// ===================================================================
// INICIALIZAÇÃO DO CRON
// ===================================================================

exports.startAutoMessageScheduler = () => {
  // CRON JOB 1: A CADA MINUTO
  // Usado para gatilhos de alta frequência (ex: 1 MINUTO antes)
  cron.schedule("*/1 * * * *", () => {
    // Verifica agendamentos com 1 minuto de antecedência (dentro da janela de 5 minutos)
    checkAndSendAppointmentReminders("APPOINTMENT_1_MIN_BEFORE", 0);
  });

  // CRON JOB 2: DIÁRIO
  // Roda todos os dias à 01:00 da manhã
  cron.schedule("0 1 * * *", () => {
    // Lembrete de 2 dias antes
    checkAndSendAppointmentReminders("APPOINTMENT_2_DAYS_BEFORE", 2);

    // Lembrete de 1 dia antes
    checkAndSendAppointmentReminders("APPOINTMENT_1_DAY_BEFORE", 1);

    // Aniversários
    checkAndSendBirthdayWishes();
  });

  console.log("--- Agendador de Mensagens Automáticas Iniciado. ---");
};

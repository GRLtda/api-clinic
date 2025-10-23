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

// ===================================================================
// UTILS DE FORMATAÇÃO E PREENCHIMENTO
// ===================================================================

const formatPhoneForBrazil = (phone) => {
  if (!phone) return phone;

  // Remove todos os caracteres não numéricos
  const cleanPhone = phone.replace(/\D/g, "");

  // Se já tem o prefixo 55, retorna como está
  if (cleanPhone.startsWith("55")) {
    return cleanPhone;
  }

  // Se tem 11 dígitos (DDD + 9 dígitos), adiciona o 55
  if (cleanPhone.length === 11) {
    return `55${cleanPhone}`;
  }

  // Se tem 10 dígitos (DDD + 8 dígitos), adiciona o 55
  if (cleanPhone.length === 10) {
    return `55${cleanPhone}`;
  }

  // Para outros casos, adiciona o 55 no início
  return `55${cleanPhone}`;
};

const fillTemplate = (templateContent, data) => {
  let content = templateContent;

  // CORREÇÃO: Substitui com e sem espaços
  content = content.replace(/{ paciente }/g, data.patientName || "Paciente");
  content = content.replace(/{paciente}/g, data.patientName || "Paciente");

  content = content.replace(/{ clinica }/g, data.clinicName || "Clínica");
  content = content.replace(/{ nome_medico }/g, data.doctorName || "Dr(a).");

  content = content.replace(/{ data_consulta }/g, data.appointmentDate || "");
  content = content.replace(/{ hora_consulta }/g, data.appointmentTime || "");

  content = content.replace(/{ link_anamnese }/g, data.anamnesisLink || "");

  return content.trim();
};

const formatDate = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleDateString("pt-BR");
};

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
  const formattedPhone = formatPhoneForBrazil(recipientPhone);

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
    const client = await initializeClient(clinicId);

    if (client.qrCode) {
      // Se não está conectado, marca como pendente para retry posterior
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.PENDING_CONNECTION,
        errorMessage: "Cliente WhatsApp não conectado - aguardando conexão",
      });

      const timestamp = new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      });
      console.log(
        `[${settingType} ${timestamp}] Cliente não conectado. Mensagem ${logEntry._id} marcada para retry quando conectar.`
      );
      return;
    }

    const result = await sendMessage(clinicId, formattedPhone, finalMessage);

    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: LOG_STATUS.DELIVERED,
      wwebjsMessageId: result.id.id,
    });

    const timestamp = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    console.log(
      `[${settingType} ${timestamp}] Mensagem enviada para ${formattedPhone}. Log ID: ${logEntry._id}`
    );
  } catch (error) {
    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: LOG_STATUS.ERROR_WHATSAPP,
      errorMessage: error.message,
    });
    const timestamp = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    console.error(
      `[${settingType} ${timestamp}] ERRO ao enviar mensagem para ${formattedPhone}: ${error.message}`
    );
  }
};

// ===================================================================
// LÓGICA DE RETRY DE MENSAGENS PENDENTES
// ===================================================================

const retryPendingMessages = async (clinicId) => {
  const timestamp = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  console.log(
    `[RETRY ${timestamp}] Verificando mensagens pendentes para clínica ${clinicId}...`
  );

  try {
    // Primeiro verifica se o cliente está conectado
    const { getClientStatus } = require("../conexao/whatsapp.client");
    const clientStatus = getClientStatus(clinicId);

    if (clientStatus !== "connected") {
      console.log(
        `[RETRY ${timestamp}] Cliente ${clinicId} não está conectado (status: ${clientStatus}). Pulando retry.`
      );
      return;
    }

    // Busca mensagens pendentes por falta de conexão
    const pendingMessages = await MessageLog.find({
      clinic: clinicId,
      status: LOG_STATUS.PENDING_CONNECTION,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Últimas 24h
    })
      .populate("patient", "name phone")
      .populate("template");

    if (pendingMessages.length === 0) {
      console.log(
        `[RETRY ${timestamp}] Nenhuma mensagem pendente para clínica ${clinicId}.`
      );
      return;
    }

    console.log(
      `[RETRY ${timestamp}] Encontradas ${pendingMessages.length} mensagens pendentes para retry.`
    );

    for (const messageLog of pendingMessages) {
      try {
        const formattedPhone = formatPhoneForBrazil(messageLog.recipientPhone);
        const result = await sendMessage(
          clinicId,
          formattedPhone,
          messageLog.messageContent
        );

        await MessageLog.findByIdAndUpdate(messageLog._id, {
          status: LOG_STATUS.DELIVERED,
          wwebjsMessageId: result.id.id,
          retryCount: (messageLog.retryCount || 0) + 1,
        });

        console.log(
          `[RETRY ${timestamp}] Mensagem ${messageLog._id} reenviada com sucesso para ${formattedPhone}.`
        );
      } catch (error) {
        await MessageLog.findByIdAndUpdate(messageLog._id, {
          status: LOG_STATUS.ERROR_WHATSAPP,
          errorMessage: `Retry falhou: ${error.message}`,
          retryCount: (messageLog.retryCount || 0) + 1,
        });

        console.error(
          `[RETRY ${timestamp}] Falha ao reenviar mensagem ${messageLog._id}: ${error.message}`
        );
      }
    }

    console.log(
      `[RETRY ${timestamp}] Finalizado retry de mensagens pendentes para clínica ${clinicId}.`
    );
  } catch (error) {
    console.error(
      `[RETRY ${timestamp}] Erro ao processar mensagens pendentes: ${error.message}`
    );
  }
};

// ===================================================================
// LÓGICA DE AQUECIMENTO DA CONEXÃO (WARM-UP)
// ===================================================================

const runClientWarmUp = async () => {
  const now = new Date();
  const timestamp = now.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  console.log(
    `[WARMUP ${timestamp}] Iniciando aquecimento de conexões (3 min antes)...`
  );

  // Verifica agendamentos entre 3 e 4 minutos à frente.
  const targetStart = new Date(now.getTime() + 3 * 60 * 1000);
  const targetEnd = new Date(now.getTime() + 4 * 60 * 1000);

  // Busca IDs únicos das clínicas que têm agendamentos em 3-4 minutos
  const appointments = await Appointment.find({
    startTime: {
      $gte: targetStart,
      $lte: targetEnd,
    },
    status: { $in: ["Agendado", "Confirmado"] },
  }).distinct("clinic");

  if (appointments.length === 0) {
    console.log(
      `[WARMUP ${timestamp}] Nenhuma clínica com agendamento próximo.`
    );
    return;
  }

  for (const clinicId of appointments) {
    // Tenta iniciar/restaurar o cliente para esta clínica
    const client = await initializeClient(clinicId);
    const status =
      client.qrCode === null
        ? "conectado"
        : client.qrCode
        ? "aguardando QR"
        : "iniciando";
    console.log(
      `[WARMUP ${timestamp}] Cliente para ${clinicId} acionado. Status atual: ${status}.`
    );

    // Se o cliente está conectado, tenta reenviar mensagens pendentes
    if (client.qrCode === null) {
      console.log(
        `[WARMUP ${timestamp}] Cliente ${clinicId} conectado. Tentando reenviar mensagens pendentes...`
      );
      await retryPendingMessages(clinicId);
    }
  }

  console.log(`[WARMUP ${timestamp}] Finalizado aquecimento de conexões.`);
};

// ===================================================================
// LÓGICA DE LEMBRETES DE CONSULTA
// ===================================================================

const checkAndSendAppointmentReminders = async (type, daysOffset) => {
  const now = new Date();
  const timestamp = now.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  console.log(`[SCHEDULER ${timestamp}] Iniciando verificação de ${type}...`);

  const activeSettings = await MessageSetting.find({
    type: type,
    isActive: true,
  })
    .populate("template")
    .populate({
      path: "clinic",
      select: "name owner",
      populate: {
        path: "owner",
        select: "name",
      },
    });

  if (activeSettings.length === 0) {
    // Esta mensagem está correta: Não há nenhuma clínica com esta configuração ATIVA.
    console.log(`[SCHEDULER ${timestamp}] Nenhuma clínica com ${type} ativo.`);
    return;
  }

  for (const setting of activeSettings) {
    const clinicId = setting.clinic._id;
    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner.name;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    let targetStart = new Date(now);
    let targetEnd = new Date(now);

    // --- DEFINIÇÃO DA JANELA DE BUSCA ---
    if (daysOffset > 0) {
      // Gatilhos de 1 ou 2 dias antes (Diário)
      targetStart.setDate(now.getDate() + daysOffset);
      targetEnd.setDate(targetStart.getDate());
      targetStart.setHours(0, 0, 0, 0);
      targetEnd.setHours(23, 59, 59, 999);
    } else if (type === "APPOINTMENT_1_MIN_BEFORE") {
      // CORREÇÃO: Busca agendamentos que começam exatamente em 1 minuto
      // Remove a janela de 2 minutos que estava causando o envio antecipado
      const oneMinuteFromNow = new Date(now.getTime() + 1 * 60 * 1000);
      targetStart = new Date(oneMinuteFromNow.getTime() - 30 * 1000); // 30 segundos antes
      targetEnd = new Date(oneMinuteFromNow.getTime() + 30 * 1000); // 30 segundos depois
      console.log(
        `[${type} ${timestamp}] Buscando agendamentos entre ${targetStart.toLocaleString(
          "pt-BR"
        )} e ${targetEnd.toLocaleString("pt-BR")}`
      );
    }

    // Evita o processamento de agendamentos que já passaram
    if (targetEnd <= now) {
      console.log(
        `[${type} ${timestamp}] Aviso: Janela de busca para ${clinicId} está no passado. Pulando.`
      );
      continue;
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
  const finalTimestamp = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  console.log(
    `[SCHEDULER ${finalTimestamp}] Finalizado verificação de ${type}.`
  );
};

// ===================================================================
// LÓGICA DE ANIVERSÁRIO
// ===================================================================

const checkAndSendBirthdayWishes = async () => {
  const type = "PATIENT_BIRTHDAY";
  const now = new Date();
  const timestamp = now.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  console.log(`[SCHEDULER ${timestamp}] Iniciando verificação de ${type}...`);

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
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));

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
      const alreadySent = await MessageLog.findOne({
        clinic: clinicId,
        patient: patientData._id,
        settingType: type,
        status: {
          $in: [LOG_STATUS.SENT_ATTEMPT, LOG_STATUS.DELIVERED, LOG_STATUS.READ],
        },
        createdAt: { $gte: startOfDay },
      });

      if (alreadySent) {
        const skipTimestamp = new Date().toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        });
        console.log(
          `[${type} ${skipTimestamp}] Mensagem para ${patientData.name} (${patientData.phone}) já foi enviada hoje. Pulando.`
        );
        continue;
      }

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
  const finalTimestamp = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  console.log(
    `[SCHEDULER ${finalTimestamp}] Finalizado verificação de ${type}.`
  );
};

// ===================================================================
// INICIALIZAÇÃO DO CRON
// ===================================================================

// Exporta a função de retry para uso externo
exports.retryPendingMessages = retryPendingMessages;

exports.startAutoMessageScheduler = () => {
  // CRON JOB 1: A CADA MINUTO
  cron.schedule("*/1 * * * *", () => {
    // 1. WARM-UP: Roda para todas as clínicas com agendamentos próximos (3-4 min)
    runClientWarmUp();

    // 2. ENVIO: Roda apenas para clínicas que ATIVARAM o gatilho "1 minuto antes" no DB.
    checkAndSendAppointmentReminders("APPOINTMENT_1_MIN_BEFORE", 0);
  });

  // CRON JOB 2: DIÁRIO
  cron.schedule("0 1 * * *", () => {
    checkAndSendAppointmentReminders("APPOINTMENT_2_DAYS_BEFORE", 2);
    checkAndSendAppointmentReminders("APPOINTMENT_1_DAY_BEFORE", 1);
    checkAndSendBirthdayWishes();
  });

  // CRON JOB 3: RETRY DE MENSAGENS PENDENTES A CADA 5 MINUTOS
  cron.schedule("*/5 * * * *", async () => {
    const timestamp = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    console.log(
      `[RETRY_SCHEDULER ${timestamp}] Verificando mensagens pendentes em todas as clínicas...`
    );

    try {
      // Busca todas as clínicas que têm mensagens pendentes
      const clinicsWithPendingMessages = await MessageLog.distinct("clinic", {
        status: LOG_STATUS.PENDING_CONNECTION,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Últimas 24h
      });

      for (const clinicId of clinicsWithPendingMessages) {
        await retryPendingMessages(clinicId);
      }
    } catch (error) {
      console.error(
        `[RETRY_SCHEDULER ${timestamp}] Erro ao processar retry: ${error.message}`
      );
    }
  });

  console.log("--- Agendador de Mensagens Automáticas Iniciado. ---");
};

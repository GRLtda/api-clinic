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
const { captureException } = require('../../../utils/sentry'); // NOVO IMPORT SENTRY

// ===================================================================
// UTILS DE FORMATAÇÃO E PREENCHIMENTO
// ===================================================================

const fillTemplate = (templateContent, data) => {
  let content = templateContent;

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
  const formattedPhone = recipientPhone;

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
      throw new Error(
        `Cliente WhatsApp da clínica ${clinicId} não está conectado (Aguardando QR Code).`
      );
    }

    const result = await sendMessage(clinicId, formattedPhone, finalMessage);

    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: LOG_STATUS.DELIVERED,
      wwebjsMessageId: result.id.id,
    });

    console.log(
      `[${settingType}] Mensagem enviada para ${formattedPhone}. Log ID: ${logEntry._id}`
    );
  } catch (error) {
    
    // LOG SENTRY: Captura o erro automático
    captureException(error, {
        tags: {
            severity: 'whatsapp_automatic_failure',
            clinic_id: clinicId.toString(),
            setting_type: settingType,
        },
        extra: {
            patient_id: patientId.toString(),
            phone: recipientPhone,
            message_preview: finalMessage.substring(0, 50),
        }
    });

    // Atualiza o log no DB
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
// LÓGICA DE AQUECIMENTO DA CONEXÃO (WARM-UP)
// ===================================================================

const runClientWarmUp = async () => {
    console.log('[WARMUP] Iniciando aquecimento de conexões (3 min antes)...');
    
    const now = new Date();
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
    }).distinct('clinic'); 

    if (appointments.length === 0) {
        console.log('[WARMUP] Nenhuma clínica com agendamento próximo.');
        return;
    }

    for (const clinicId of appointments) {
        try {
            // Tenta iniciar/restaurar o cliente para esta clínica
            const client = await initializeClient(clinicId);
            const status = client.qrCode === null ? 'conectado' : client.qrCode ? 'aguardando QR' : 'iniciando';
            console.log(`[WARMUP] Cliente para ${clinicId} acionado. Status atual: ${status}.`);
        } catch (error) {
            // Se falhar na inicialização, captura no Sentry, mas não interrompe o scheduler
            captureException(error, {
                tags: {
                    severity: 'whatsapp_warmup_failure',
                    clinic_id: clinicId.toString(),
                },
                extra: {
                    error_detail: 'Falha ao iniciar cliente para warm-up'
                }
            });
        }
    }

    console.log('[WARMUP] Finalizado aquecimento de conexões.');
};

// ===================================================================
// LÓGICA DE LEMBRETES DE CONSULTA
// ===================================================================

const checkAndSendAppointmentReminders = async (type, daysOffset) => {
  console.log(`[SCHEDULER] Iniciando verificação de ${type}...`);

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
    console.log(`[SCHEDULER] Nenhuma clínica com ${type} ativo.`); 
    return;
  }

  for (const setting of activeSettings) {
    const clinicId = setting.clinic._id;
    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner.name;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    const now = new Date();
    let targetStart = new Date(now);
    let targetEnd = new Date(now);

    // --- DEFINIÇÃO DA JANELA DE BUSCA ---
    if (daysOffset > 0) {
      // Gatilhos de 1 ou 2 dias antes (Diário)
      targetStart.setDate(now.getDate() + daysOffset);
      targetEnd.setDate(targetStart.getDate());
      targetStart.setHours(0, 0, 0, 0);
      targetEnd.setHours(23, 59, 59, 999);
    } else if (type === 'APPOINTMENT_1_MIN_BEFORE') {
        // Gatilho de 1 minuto antes (Envio)
        targetStart = new Date(now.getTime() + 1 * 60 * 1000); 
        targetEnd = new Date(now.getTime() + 2 * 60 * 1000); 
    }
    
    // Evita o processamento de agendamentos que já passaram
    if (targetEnd <= now) {
         console.log(`[${type}] Aviso: Janela de busca para ${clinicId} está no passado. Pulando.`);
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
                status: { $in: [LOG_STATUS.SENT_ATTEMPT, LOG_STATUS.DELIVERED, LOG_STATUS.READ] },
                createdAt: { $gte: startOfDay }
            });

            if (alreadySent) {
                console.log(`[${type}] Mensagem para ${patientData.name} (${patientData.phone}) já foi enviada hoje. Pulando.`);
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
    console.log(`[SCHEDULER] Finalizado verificação de ${type}.`);
};


// ===================================================================
// INICIALIZAÇÃO DO CRON
// ===================================================================

exports.startAutoMessageScheduler = () => {
  // CRON JOB 1: A CADA MINUTO
  cron.schedule("*/1 * * * *", () => {
    // 1. WARM-UP: Tenta aquecer a conexão 3 minutos antes (Não depende de configuração no DB)
    runClientWarmUp(); 
    
    // 2. ENVIO: Roda apenas para clínicas com o gatilho ativo no DB.
    checkAndSendAppointmentReminders("APPOINTMENT_1_MIN_BEFORE", 0);
  });

  // CRON JOB 2: DIÁRIO
  cron.schedule("0 1 * * *", () => {
    checkAndSendAppointmentReminders("APPOINTMENT_2_DAYS_BEFORE", 2);
    checkAndSendAppointmentReminders("APPOINTMENT_1_DAY_BEFORE", 1);
    checkAndSendBirthdayWishes();
  });

  console.log("--- Agendador de Mensagens Automáticas Iniciado. ---");
};
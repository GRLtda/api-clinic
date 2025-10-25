// src/api/crm/scheduler/auto-message.service.js
const cron = require("node-cron");
const MessageSetting = require("../message-settings.model");
const MessageTemplate = require("../modelos/message-template.model");
const Appointment = require("../../appointments/appointments.model");
const Patient = require("../../patients/patients.model");
// Importa o cliente HTTP para comunicar com o serviço WhatsApp dedicado
const whatsappServiceClient = require('../../../services/whatsappServiceClient');
const { createLogEntry } = require("../logs/message-log.controller");
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require("../logs/message-log.model");
const { captureException } = require('../../../utils/sentry');

// ===================================================================
// UTILS DE FORMATAÇÃO E PREENCHIMENTO (Podem permanecer aqui ou ir para um utils compartilhado)
// ===================================================================

const fillTemplate = (templateContent, data) => {
    let content = templateContent;
    content = content.replace(/{ paciente }/g, data.patientName || "Paciente");
    content = content.replace(/{paciente}/g, data.patientName || "Paciente");
    content = content.replace(/{ clinica }/g, data.clinicName || "Clínica");
    content = content.replace(/{ nome_medico }/g, data.doctorName || "Dr(a).");
    content = content.replace(/{ data_consulta }/g, data.appointmentDate || "");
    content = content.replace(/{ hora_consulta }/g, data.appointmentTime || "");
    content = content.replace(/{ link_anamnese }/g, data.anamnesisLink || ""); // Adicionar lógica se aplicável
    return content.trim();
};

const formatDate = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleDateString("pt-BR");
};

const formatTime = (date) => {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

// ===================================================================
// FUNÇÃO CENTRAL DE ENVIO (COM LOG LOCAL E CHAMADA AO SERVIÇO)
// ===================================================================

const trySendMessageAndLog = async ({
  clinicId,
  patientId,
  recipientPhone,
  finalMessage,
  settingType, // Ex: 'APPOINTMENT_1_DAY_BEFORE', 'PATIENT_BIRTHDAY'
  templateId,
}) => {
  const formattedPhone = recipientPhone; // Assume que o número já está formatado corretamente

  let logEntry;
  try {
    // 1. Cria o log local com status SENT_ATTEMPT
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
          : ACTION_TYPES.AUTOMATIC_REMINDER, // Ajustar se houver mais tipos automáticos
    });

    if (!logEntry) {
        throw new Error("Falha ao criar entrada de log inicial.");
    }

    // 2. Chama o serviço WhatsApp dedicado para realizar o envio
    // console.log(`[SCHEDULER ${clinicId}] Solicitando envio para ${formattedPhone} via serviço...`);
    const response = await whatsappServiceClient.sendMessage(clinicId, formattedPhone, finalMessage);
    // console.log(`[SCHEDULER ${clinicId}] Resposta do serviço para ${formattedPhone}:`, response.status);

    // 3. Atualiza o log local para DELIVERED (ou outro status apropriado se o serviço retornar)
    await MessageLog.findByIdAndUpdate(logEntry._id, {
      status: LOG_STATUS.DELIVERED, // Assumimos sucesso se não houve erro na chamada
      wwebjsMessageId: response.data?.result?.id?.id || null, // Captura ID da mensagem se retornado
    });

    console.log(`[SCHEDULER ${settingType}] Mensagem enviada para ${formattedPhone} via serviço. Log ID: ${logEntry._id}`);

  } catch (error) {
    // 4. Em caso de erro na comunicação ou erro retornado pelo serviço:
    captureException(error, {
        tags: {
            severity: 'whatsapp_automatic_failure',
            clinic_id: clinicId.toString(),
            setting_type: settingType,
            context: 'autoMessageServiceSend'
        },
        extra: {
            patient_id: patientId.toString(),
            phone: recipientPhone,
            log_id: logEntry?._id?.toString() || 'N/A',
            error_message: error.response?.data?.message || error.message
        }
    });

    // Atualiza o log no DB para indicar o erro
    if (logEntry) {
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.ERROR_SYSTEM, // Indica erro na API ou comunicação
        errorMessage: `Erro via serviço: ${error.response?.data?.message || error.message}`,
      });
    }
    console.error(`[SCHEDULER ${settingType}] ERRO ao solicitar envio para ${formattedPhone} via serviço: ${error.response?.data?.message || error.message}`);
  }
};

// ===================================================================
// LÓGICA DE LEMBRETES DE CONSULTA (Busca dados e chama trySendMessageAndLog)
// ===================================================================

const checkAndSendAppointmentReminders = async (type, daysOffset) => {
  // console.log(`[SCHEDULER] Iniciando verificação de ${type}...`);

  const activeSettings = await MessageSetting.find({ type: type, isActive: true })
    .populate("template")
    .populate({
      path: "clinic",
      select: "name owner", // Seleciona apenas campos necessários
      populate: { path: "owner", select: "name" }, // Popula nome do dono (médico?)
    });

  if (activeSettings.length === 0) {
    // console.log(`[SCHEDULER] Nenhuma configuração ativa para ${type}.`);
    return;
  }

  for (const setting of activeSettings) {
    // Verifica se os dados populados existem antes de prosseguir
    if (!setting.template || !setting.clinic || !setting.clinic.owner) {
        console.warn(`[SCHEDULER ${type}] Configuração ${setting._id} com dados incompletos (template, clinica ou owner). Pulando.`);
        continue;
    }

    const clinicId = setting.clinic._id;
    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner.name; // Assumindo que owner é o médico principal
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    const now = new Date();
    let targetStart = new Date(now);
    let targetEnd = new Date(now);

    // Definição da janela de busca (sem alterações)
    if (daysOffset > 0) {
      targetStart.setDate(now.getDate() + daysOffset);
      targetEnd.setDate(targetStart.getDate());
      targetStart.setHours(0, 0, 0, 0);
      targetEnd.setHours(23, 59, 59, 999);
    } else if (type === 'APPOINTMENT_1_MIN_BEFORE') {
        targetStart = new Date(now.getTime() + 1 * 60 * 1000);
        targetEnd = new Date(now.getTime() + 2 * 60 * 1000);
    } else {
        console.warn(`[SCHEDULER ${type}] Tipo de offset não tratado para ${clinicId}. Pulando.`);
        continue; // Pula se o tipo não for esperado
    }

    if (targetEnd <= now) {
         console.log(`[SCHEDULER ${type}] Janela de busca para ${clinicId} está no passado. Pulando.`);
         continue;
    }

    const appointments = await Appointment.find({
      clinic: clinicId,
      startTime: { $gte: targetStart, $lte: targetEnd },
      status: { $in: ["Agendado", "Confirmado"] },
    }).populate("patient", "name phone"); // Busca nome e telefone do paciente

    for (const appointment of appointments) {
        if (!appointment.patient || !appointment.patient.phone) {
            console.warn(`[SCHEDULER ${type}] Agendamento ${appointment._id} sem paciente ou telefone. Pulando.`);
            continue;
        }

      const finalMessage = fillTemplate(templateContent, {
        patientName: appointment.patient.name,
        clinicName: clinicName,
        doctorName: doctorName,
        appointmentDate: formatDate(appointment.startTime),
        appointmentTime: formatTime(appointment.startTime),
      });

      // Chama a função refatorada que usa o serviço dedicado
      await trySendMessageAndLog({
        clinicId: clinicId,
        patientId: appointment.patient._id,
        recipientPhone: appointment.patient.phone, // Número já vem do populate
        finalMessage: finalMessage,
        settingType: type,
        templateId: templateId,
      });
    }
  }
  // console.log(`[SCHEDULER] Finalizado verificação de ${type}.`);
};

// ===================================================================
// LÓGICA DE ANIVERSÁRIO (Busca dados e chama trySendMessageAndLog)
// ===================================================================

const checkAndSendBirthdayWishes = async () => {
    const type = "PATIENT_BIRTHDAY";
    // console.log(`[SCHEDULER] Iniciando verificação de ${type}...`);

    const activeSettings = await MessageSetting.find({ type: type, isActive: true })
        .populate("template")
        .populate({
            path: "clinic",
            select: "name owner",
            populate: { path: "owner", select: "name" },
        });

    if (activeSettings.length === 0) return;

    for (const setting of activeSettings) {
         if (!setting.template || !setting.clinic || !setting.clinic.owner) {
             console.warn(`[SCHEDULER ${type}] Configuração ${setting._id} com dados incompletos. Pulando.`);
             continue;
         }

        const clinicId = setting.clinic._id;
        const clinicName = setting.clinic.name;
        const doctorName = setting.clinic.owner.name;
        const templateContent = setting.template.content;
        const templateId = setting.template._id;

        const today = new Date();
        const todayDay = today.getDate();
        const todayMonth = today.getMonth() + 1; // Mês é 0-indexado
        const startOfDay = new Date(today.setHours(0, 0, 0, 0)); // Início do dia para verificar envio

        // Busca pacientes da clínica que fazem aniversário hoje
        const birthdayPatients = await Patient.find({
            clinicId: clinicId,
            $expr: {
                $and: [
                    { $eq: [{ $dayOfMonth: "$birthDate" }, todayDay] },
                    { $eq: [{ $month: "$birthDate" }, todayMonth] },
                ],
            },
            deletedAt: { $exists: false } // Ignora pacientes deletados
        }).select("name phone"); // Seleciona apenas campos necessários

        for (const patientData of birthdayPatients) {
            if (!patientData.phone) {
                 console.warn(`[SCHEDULER ${type}] Paciente ${patientData._id} (${patientData.name}) sem telefone. Pulando.`);
                 continue;
            }

            // Verifica se já foi enviada uma mensagem de aniversário HOJE para este paciente
            const alreadySentToday = await MessageLog.exists({
                clinic: clinicId,
                patient: patientData._id,
                settingType: type,
                actionType: ACTION_TYPES.AUTOMATIC_BIRTHDAY, // Especifica o tipo de ação
                // Verifica se foi enviado com sucesso ou tentativa hoje
                status: { $in: [LOG_STATUS.SENT_ATTEMPT, LOG_STATUS.DELIVERED, LOG_STATUS.READ] },
                createdAt: { $gte: startOfDay } // Verifica apenas logs criados hoje
            });

            if (alreadySentToday) {
                // console.log(`[SCHEDULER ${type}] Mensagem para ${patientData.name} (${patientData.phone}) já enviada hoje. Pulando.`);
                continue;
            }

            const finalMessage = fillTemplate(templateContent, {
                patientName: patientData.name,
                clinicName: clinicName,
                doctorName: doctorName,
            });

            // Chama a função refatorada
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
    // console.log(`[SCHEDULER] Finalizado verificação de ${type}.`);
};

// ===================================================================
// INICIALIZAÇÃO DO CRON (Sem warm-up, apenas agendamentos)
// ===================================================================

exports.startAutoMessageScheduler = () => {
  console.log("--- Iniciando Agendador de Mensagens Automáticas (sem warm-up local)... ---");

  // CRON JOB 1: A CADA MINUTO (para lembretes de X minutos antes)
  // Ajuste o tipo conforme definido no seu MessageSetting model
  cron.schedule("*/1 * * * *", () => {
    checkAndSendAppointmentReminders("APPOINTMENT_1_MIN_BEFORE", 0); // Exemplo
    // Adicionar outros lembretes de minutos aqui se necessário
  });

  // CRON JOB 2: DIÁRIO (Ex: 1h da manhã)
  cron.schedule("0 1 * * *", () => {
    console.log("[SCHEDULER DIÁRIO] Iniciando tarefas diárias (aniversários, lembretes de dias)...");
    checkAndSendAppointmentReminders("APPOINTMENT_2_DAYS_BEFORE", 2);
    checkAndSendAppointmentReminders("APPOINTMENT_1_DAY_BEFORE", 1);
    checkAndSendBirthdayWishes();
    console.log("[SCHEDULER DIÁRIO] Tarefas diárias concluídas.");
  });

  console.log("--- Agendador de Mensagens Automáticas Iniciado. ---");
  // Log inicial para confirmar que foi chamado
};
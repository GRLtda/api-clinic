const MessageSetting = require('../crm/message-settings.model');
const Clinic = require('../clinics/clinics.model');
const Patient = require('../patients/patients.model');
const Appointment = require('./appointments.model'); // Trocado
const whatsappServiceClient = require('../../services/whatsappServiceClient');
const { createLogEntry } = require('../crm/logs/message-log.controller');
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require('../crm/logs/message-log.model');
const { captureException } = require('../../utils/sentry');
const { sendToDiscord } = require('../../utils/discordLogger');

// --- NOVO: Importar Luxon para datas ---
const { DateTime } = require('luxon');
const BR_TZ = 'America/Sao_Paulo'; // Fuso de Brasília

// --- Helper local (Modificado) ---
// Agora preenche as variáveis de consulta
const fillTemplate = (templateContent, data) => {
  let content = templateContent || '';
  const patientFullName = data.patientName || 'Paciente';
  const patientFirstName = patientFullName.split(' ')[0];

  content = content.replace(/{ ?paciente ?}/g, patientFullName);
  content = content.replace(/{ ?primeiro_nome ?}/g, patientFirstName);
  content = content.replace(/{ ?clinica ?}/g, data.clinicName || 'Clínica');
  content = content.replace(/{ ?nome_medico ?}/g, data.doctorName || 'Dr(a).');
  
  // Variáveis de consulta
  content = content.replace(/{ ?data_consulta ?}/g, data.dataConsulta || '');
  content = content.replace(/{ ?hora_consulta ?}/g, data.horaConsulta || '');

  // Variável de anamnese (não se aplica aqui)
  content = content.replace(/{ ?link_anamnese ?}/g, '');
  return content.trim();
};

/**
 * Tenta enviar a notificação de CONFIRMAÇÃO de agendamento.
 * @param {import('mongoose').Document<Appointment>} appointmentDoc - O documento do agendamento (do update).
 */
exports.sendAppointmentConfirmation = async (appointmentDoc) => {
  // --- GATILHO MUDOU ---
  const GATILHO = 'APPOINTMENT_CONFIRMATION';
  const { clinic, patient, _id: appointmentId, startTime } = appointmentDoc;

  let logEntry;
  const settingType = GATILHO;
  const taskName = GATILHO; 

  try {
    // 1. Buscar a configuração (template) que a clínica definiu para este gatilho
    const setting = await MessageSetting.findOne({
      clinic,
      type: settingType,
      isActive: true,
    })
      .populate('template', 'content')
      .populate({
        path: 'clinic',
        select: 'name owner',
        populate: { path: 'owner', select: 'name' },
      })
      .lean();
    
    // Se não houver configuração ativa, não faz nada
    if (!setting || !setting.template?.content || !setting.clinic?.name) {
      sendToDiscord(`Clínica ${clinic} não possui template ativo para ${settingType}.`, 'info', taskName);
      return;
    }

    // 2. Buscar dados do paciente
    const patientDoc = await Patient.findById(patient).select('name phone').lean();
    if (!patientDoc || !patientDoc.phone) {
      sendToDiscord(`Paciente ${patient} sem telefone, impossível notificar ${taskName}.`, 'warn', taskName);
      return;
    }

    // 3. Montar dados
    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner?.name || clinicName;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    // --- LÓGICA DE DATA/HORA (NOVO) ---
    // Converte a data (que está em UTC) para o fuso de Brasília
    const dt = DateTime.fromJSDate(startTime, { zone: 'utc' }).setZone(BR_TZ);
    
    const dataConsulta = dt.toFormat('dd/MM/yyyy (cccc)'); // ex: 12/11/2025 (Quarta-feira)
    const horaConsulta = dt.toFormat('HH:mm'); // ex: 14:30
    // --- FIM DA LÓGICA DE DATA ---

    const finalMessage = fillTemplate(templateContent, {
      patientName: patientDoc.name,
      clinicName,
      doctorName,
      dataConsulta, // Novo
      horaConsulta, // Novo
    });

    // --- Definição dos Botões (Modificado) ---
    const messageOptions = {
      footer: `Enviado por: ${clinicName}`,
      buttons: [
        { id: `appt_help_${appointmentId}`, text: 'Preciso de Ajuda' },
        { id: `appt_reschedule_${appointmentId}`, text: 'Quero Reagendar' }
      ]
    };
    // --- FIM DA MODIFICAÇÃO ---

    const formattedPhone = patientDoc.phone.replace(/\D/g, '');

    // 4. Criar log de tentativa
    logEntry = await createLogEntry({
      clinic,
      patient,
      template: templateId,
      settingType,
      messageContent: finalMessage,
      recipientPhone: formattedPhone,
      status: LOG_STATUS.SENT_ATTEMPT,
      actionType: ACTION_TYPES.MANUAL_SEND, // É disparado por uma ação (confirmar)
      relatedDoc: appointmentId, // Linka o log ao agendamento
      relatedModel: 'Appointment',
    });

    // 5. Enviar via serviço (incluindo options)
    const response = await whatsappServiceClient.sendMessage(
      clinic,
      formattedPhone,
      finalMessage,
      messageOptions // Passa o footer e os buttons
    );
    const wId = response?.data?.result?.id?.id;

    // 6. Atualizar log com sucesso
    await MessageLog.findByIdAndUpdate(
      logEntry._id,
      { $set: { status: LOG_STATUS.DELIVERED, wwebjsMessageId: wId || undefined } }
    );
    
    // 7. ATUALIZAR O IDENTIFICADOR (Flag)
    // No caso do agendamento, o "gatilho" é a própria mudança de status
    // no controller. Diferente da anamnese, não precisamos setar uma flag
    // 'notificationSent=true' aqui, pois o controller já garante
    // que isso só roda na transição para "Confirmado".

    sendToDiscord(`Notificação de Confirmação (${settingType}) enviada para ${formattedPhone}`, 'success', taskName);

  } catch (error) {
    const errMsg = error?.response?.data?.message || error?.message || 'Erro desconhecido.';
    const logId = logEntry?._id?.toString() || 'N/A';

    captureException(error, {
      tags: { severity: 'whatsapp_automatic_failure', clinic_id: clinic.toString(), setting_type: settingType, context: 'appointmentNotificationService' },
      extra: { patient_id: patient.toString(), log_id: logId, appointment_id: appointmentId },
    });

    if (logEntry) {
      await MessageLog.findByIdAndUpdate(logEntry._id, {
        status: LOG_STATUS.ERROR_SYSTEM,
        errorMessage: `Erro (${taskName}): ${String(errMsg).substring(0, 500)}`,
      });
    }

    sendToDiscord(`Falha ao enviar (${settingType}) para ${formattedPhone} (Log: ${logId})\n**Erro:** ${String(errMsg).substring(0, 1000)}`, 'error', taskName);
  }
};
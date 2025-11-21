const MessageSetting = require('../crm/message-settings.model');
const Clinic = require('../clinics/clinics.model');
const Patient = require('../patients/patients.model');
const Appointment = require('./appointments.model');
const whatsappServiceClient = require('../../services/whatsappServiceClient');
const { createLogEntry } = require('../crm/logs/message-log.controller');
const { MessageLog, LOG_STATUS, ACTION_TYPES } = require('../crm/logs/message-log.model');
const { captureException } = require('../../utils/sentry');
const { sendToDiscord } = require('../../utils/discordLogger');

// --- Importar Luxon para datas ---
const { DateTime } = require('luxon');
const BR_TZ = 'America/Sao_Paulo';

// --- Helper local ---
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

  content = content.replace(/{ ?link_anamnese ?}/g, '');
  return content.trim();
};

/**
 * Tenta enviar a notificação de CONFIRMAÇÃO de agendamento.
 * @param {import('mongoose').Document<Appointment>} appointmentDoc
 */
exports.sendAppointmentConfirmation = async (appointmentDoc) => {
  const GATILHO = 'APPOINTMENT_CONFIRMATION';
  const { clinic, patient, _id: appointmentId, startTime } = appointmentDoc;

  let logEntry;
  const settingType = GATILHO;
  const taskName = GATILHO; 

  try {
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
    
    if (!setting || !setting.template?.content || !setting.clinic?.name) {
      sendToDiscord(`Clínica ${clinic} não possui template ativo para ${settingType}.`, 'info', taskName);
      return;
    }

    const patientDoc = await Patient.findById(patient).select('name phone').lean();
    if (!patientDoc || !patientDoc.phone) {
      sendToDiscord(`Paciente ${patient} sem telefone, impossível notificar ${taskName}.`, 'warn', taskName);
      return;
    }

    const clinicName = setting.clinic.name;
    const doctorName = setting.clinic.owner?.name || clinicName;
    const templateContent = setting.template.content;
    const templateId = setting.template._id;

    const dt = DateTime.fromJSDate(startTime, { zone: 'utc' })
      .setZone(BR_TZ)
      .setLocale('pt-BR');
    
    let dataConsulta = dt.toFormat('dd/MM/yyyy (cccc)'); 
    dataConsulta = dataConsulta.replace(/\((.)/, (match) => match.toUpperCase());

    const horaConsulta = dt.toFormat('HH:mm');

    const finalMessage = fillTemplate(templateContent, {
      patientName: patientDoc.name,
      clinicName,
      doctorName,
      dataConsulta,
      horaConsulta,
    });

    const messageOptions = {
      footer: `Enviado por: ${clinicName}`,
      buttons: [
        { id: `appt_help_${appointmentId}`, text: 'Preciso de Ajuda' },
        { id: `appt_reschedule_${appointmentId}`, text: 'Quero Reagendar' }
      ]
    };

    const formattedPhone = patientDoc.phone.replace(/\D/g, '');

    logEntry = await createLogEntry({
      clinic,
      patient,
      template: templateId,
      settingType,
      messageContent: finalMessage,
      recipientPhone: formattedPhone,
      status: LOG_STATUS.SENT_ATTEMPT,
      actionType: ACTION_TYPES.MANUAL_SEND,
      relatedDoc: appointmentId,
      relatedModel: 'Appointment',
    });

    const response = await whatsappServiceClient.sendMessage(
      clinic,
      formattedPhone,
      finalMessage,
      messageOptions
    );
    const wId = response?.data?.result?.id?.id;

    await MessageLog.findByIdAndUpdate(
      logEntry._id,
      { $set: { status: LOG_STATUS.DELIVERED, wwebjsMessageId: wId || undefined } }
    );
    
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
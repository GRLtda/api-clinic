// jobs/reminders.job.js
const axios = require('axios');
const { DateTime } = require('luxon');
const Appointment = require('../api/appointments/appointments.model');

const BR_TZ = 'America/Sao_Paulo';

// Janela de varredura: tolerância de +/- 2 minutos (ajuste como preferir)
const WINDOW_MINUTES = 2;

async function runRemindersSweep() {
  // Trabalhe sempre em UTC, porque seus Date no Mongo estão em UTC
  const nowUtc = DateTime.utc();

  // 1 dia antes
  const oneDayTargetStart = nowUtc.plus({ days: 1 }).minus({ minutes: WINDOW_MINUTES });
  const oneDayTargetEnd   = nowUtc.plus({ days: 1 }).plus({ minutes: WINDOW_MINUTES });

  // 2 horas antes (se quiser 3h, troque para { hours: 3 })
  const twoHoursTargetStart = nowUtc.plus({ hours: 2 }).minus({ minutes: WINDOW_MINUTES });
  const twoHoursTargetEnd   = nowUtc.plus({ hours: 2 }).plus({ minutes: WINDOW_MINUTES });

  // Critérios comuns (não avisar para cancelados/realizados/etc.)
  const baseMatch = {
    sendReminder: true,
    status: { $in: ['Agendado', 'Confirmado'] },
  };

  // Busca 1: lembretes de 1 dia
  const dueOneDay = await Appointment.find({
    ...baseMatch,
    startTime: { $gte: oneDayTargetStart.toJSDate(), $lte: oneDayTargetEnd.toJSDate() },
    'remindersSent.oneDayBefore': false,
  })
  .populate('patient', 'name phone') // vamos precisar do telefone
  .lean();

  // Busca 2: lembretes de 2 horas
  const dueTwoHours = await Appointment.find({
    ...baseMatch,
    startTime: { $gte: twoHoursTargetStart.toJSDate(), $lte: twoHoursTargetEnd.toJSDate() },
    'remindersSent.threeHoursBefore': false, // reaproveitando o campo existente; renomeie se quiser "twoHoursBefore"
  })
  .populate('patient', 'name phone')
  .lean();

  await Promise.all([
    ...dueOneDay.map(appt => sendAndMark(appt, 'oneDayBefore')),
    ...dueTwoHours.map(appt => sendAndMark(appt, 'threeHoursBefore')), // ou "twoHoursBefore" se você ajustar o schema
  ]);
}

async function sendAndMark(appt, whichFlag) {
  // garanta que há telefone
  const phone = appt?.patient?.phone;
  if (!phone) return;

  // Mensagem (ajuste copy/idioma)
  const apptLocal = DateTime.fromJSDate(appt.startTime, { zone: BR_TZ });
  const whenStr = apptLocal.toFormat("dd/LL/yyyy 'às' HH:mm");

  const text = whichFlag === 'oneDayBefore'
    ? `Olá, ${appt.patient.name}! Lembrando sua consulta amanhã (${whenStr}). Responda se precisar reagendar.`
    : `Olá, ${appt.patient.name}! Sua consulta é em breve (${whenStr}). Qualquer dúvida, estamos à disposição.`;

  try {
    // POST para sua outra API (exemplo)
    await axios.post(process.env.WHATSAPP_API_URL + '/messages', {
      to: phone,
      message: text,
      // Inclua metadados úteis
      metadata: {
        clinicId: appt.clinic?.toString?.() || undefined,
        appointmentId: appt._id.toString(),
        type: whichFlag,
      }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
      }
    });

    // Marcar a flag de forma ATÔMICA e idempotente (só se ainda estiver false)
    await Appointment.updateOne(
      { _id: appt._id, [`remindersSent.${whichFlag}`]: false },
      { $set: { [`remindersSent.${whichFlag}`]: true } }
    );
  } catch (err) {
    // registre e considere retry/backoff
    console.error('Erro enviando lembrete', { apptId: appt._id, whichFlag, err: err?.response?.data || err.message });
  }
}

module.exports = { runRemindersSweep };

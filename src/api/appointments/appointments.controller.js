// api/appointments/appointments.controller.js
const Appointment = require('./appointments.model');
const Patient = require('../patients/patients.model');
const asyncHandler = require('../../utils/asyncHandler');
const { DateTime } = require('luxon');
const auditLogService = require('../audit/audit-log.service');

// --- Importações de Notificação ---
const { sendAppointmentConfirmation } = require('./appointment-notification.service');
const { captureException } = require('../../utils/sentry'); 

const BR_TZ = 'America/Sao_Paulo';

// ----------------- helpers -----------------
const parseToUTC = (value) => {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: BR_TZ });
  return dt.isValid ? dt.toUTC().toJSDate() : null;
};

const ensurePatientInClinic = async (patientId, clinicId) => {
  const exists = await Patient.exists({ _id: patientId, clinicId, deletedAt: { $exists: false } });
  return !!exists;
};

const hasOverlap = async ({ clinicId, patientId, startTime, endTime, ignoreId = null }) => {
  const criteria = {
    clinic: clinicId,
    patient: patientId,
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
    status: { $ne: 'Cancelado' },
  };
  if (ignoreId) criteria._id = { $ne: ignoreId };
  const count = await Appointment.countDocuments(criteria);
  return count > 0;
};

const pickUpdateFields = (body) => {
  const {
    patient,
    startTime,
    endTime,
    notes,
    status,
    returnInDays,
    sendReminder,
    reminderEnabled,
    remindersSent,
    isReturn,
    originAppointment
  } = body || {};
  
  return { patient, startTime, endTime, notes, status, returnInDays, sendReminder, reminderEnabled, remindersSent, isReturn, originAppointment }; 
};

// ---------------------------------------------------------
// @desc    Criar (agendar) uma nova consulta
// @route   POST /api/appointments
// @access  Private
// ---------------------------------------------------------
exports.createAppointment = asyncHandler(async (req, res) => {
  const { patient, startTime, endTime, notes, status, returnInDays, sendReminder, reminderEnabled, isReturn } = req.body;
  const clinicId = req.clinicId;

  // Validações
  if (!patient || !startTime || !endTime) {
    return res.status(400).json({ message: 'Paciente, data de início e data de fim são obrigatórios.' });
  }
  const start = parseToUTC(startTime);
  const end = parseToUTC(endTime);
  if (!start || !end) {
    return res.status(400).json({ message: 'Datas inválidas. Use formato ISO válido.' });
  }
  if (end <= start) {
    return res.status(400).json({ message: 'endTime deve ser maior que startTime.' });
  }

  const ok = await ensurePatientInClinic(patient, clinicId);
  if (!ok) return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });

  const overlap = await hasOverlap({ clinicId, patientId: patient, startTime: start, endTime: end });
  if (overlap) return res.status(400).json({ message: 'Conflito de horário: já existe consulta nesse intervalo.' });

  // Lógica de 'isReturn'
  let lastAppointmentId = null;
  if (isReturn === true) {
    const lastAppointment = await Appointment.findOne({
      patient: patient,
      clinic: clinicId,
      startTime: { $lt: start }
    })
    .sort({ startTime: -1 })
    .select('_id') 
    .lean();

    if (lastAppointment) {
      lastAppointmentId = lastAppointment._id;
    }
  }

  const newAppointmentData = {
    patient,
    startTime: start,
    endTime: end,
    notes,
    status,
    returnInDays: returnInDays || 0,
    isReturn: !!isReturn,
    sendReminder: !!sendReminder, // <-- Flag principal de notificação
    clinic: clinicId,
    reminderEnabled: {
      oneDayBefore:     !!reminderEnabled?.oneDayBefore,
      twoHoursBefore:   !!reminderEnabled?.twoHoursBefore,
      threeMinutesBefore: !!reminderEnabled?.threeMinutesBefore,
    },
  };

  if (lastAppointmentId) {
    newAppointmentData.originAppointment = lastAppointmentId;
  }

  // Cria o agendamento
  const newAppointment = await Appointment.create(newAppointmentData);

  // Log de Auditoria
  await auditLogService.createLog(
    req.user._id,
    req.clinicId,
    'APPOINTMENT_CREATE',
    'Appointment',
    newAppointment._id,
    {
      summary: 'Agendamento criado',
      changes: [ 
        { field: 'status', old: null, new: newAppointment.status },
        { field: 'patient', old: null, new: newAppointment.patient },
        { field: 'startTime', old: null, new: newAppointment.startTime },
        { field: 'isReturn', old: null, new: newAppointment.isReturn },
        { field: 'originAppointment', old: null, new: newAppointment.originAppointment || null },
      ]
    }
  );
  // --- Fim do Log ---

  // --- GATILHO DE NOTIFICAÇÃO (NOVO LOCAL) ---
  // Envia a notificação no momento da criação usando o serviço existente
  if (newAppointment.sendReminder === true) {
    // Dispara a notificação, mas não trava a resposta para o usuário
    sendAppointmentConfirmation(newAppointment).catch(err => {
      captureException(err, { 
        tags: { context: 'sendAppointmentCreationTrigger' }, 
        extra: { appointmentId: newAppointment._id }
      });
    });
  }
  // --- FIM DA ADIÇÃO ---

  return res.status(201).json(newAppointment);
});

// ---------------------------------------------------------
// @desc    Listar todas as consultas (base do calendário)
// ---------------------------------------------------------
exports.getAllAppointments = asyncHandler(async (req, res) => {
  let { startDate, endDate } = req.query;

  let startUTC, endUTC;

  if (!startDate || !endDate) {
    startUTC = DateTime.now().setZone(BR_TZ).startOf('day').toUTC().toJSDate();
    endUTC   = DateTime.now().setZone(BR_TZ).endOf('day').toUTC().toJSDate();
  } else {
    const sInTZ = DateTime.fromISO(startDate, { zone: BR_TZ }).startOf('day');
    const eInTZ = DateTime.fromISO(endDate, { zone: BR_TZ }).endOf('day');
    if (!sInTZ.isValid || !eInTZ.isValid) {
      return res.status(400).json({ message: 'Datas inválidas.' });
    }
    startUTC = sInTZ.toUTC().toJSDate();
    endUTC   = eInTZ.toUTC().toJSDate();
  }

  // Atualiza status para 'Não Compareceu'
  const now = new Date();
  const twoHoursInMs = 2 * 60 * 60 * 1000;
  const cutoffTime = new Date(now.getTime() - twoHoursInMs);

  await Appointment.updateMany(
    { clinic: req.clinicId, status: 'Agendado', endTime: { $lt: cutoffTime } },
    { $set: { status: 'Não Compareceu' } }
  );

  const filter = {
    clinic: req.clinicId,
    startTime: { $gte: startUTC, $lte: endUTC },
  };

  const appointments = await Appointment.find(filter)
    .populate('patient', 'name phone')
    .sort({ startTime: 1 })
    .lean();

  return res.status(200).json(appointments);
});

// ---------------------------------------------------------
// @desc    Atualizar um agendamento existente
// ---------------------------------------------------------
exports.updateAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clinicId = req.clinicId;

  const payload = pickUpdateFields(req.body);

  const fieldsToTrack = [
    'patient',
    'startTime',
    'endTime',
    'notes',
    'status',
    'returnInDays',
    'sendReminder',
    'reminderEnabled.oneDayBefore',
    'reminderEnabled.twoHoursBefore',
    'reminderEnabled.threeMinutesBefore',
  ];

  const originalAppointment = await Appointment.findOne({ _id: id, clinic: clinicId }).lean();
  if (!originalAppointment) {
    return res.status(404).json({ message: 'Agendamento não encontrado nesta clínica.' });
  }

  let start, end;
  if (payload.startTime) {
    start = parseToUTC(payload.startTime);
    if (!start) return res.status(400).json({ message: 'startTime inválido.' });
    payload.startTime = start;
  }
  if (payload.endTime) {
    end = parseToUTC(payload.endTime);
    if (!end) return res.status(400).json({ message: 'endTime inválido.' });
    payload.endTime = end;
  }
  if (start && end && end <= start) {
    return res.status(400).json({ message: 'endTime deve ser maior que startTime.' });
  }

  if (payload.patient) {
    const ok = await ensurePatientInClinic(payload.patient, clinicId);
    if (!ok) return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });
  }

  const needsOverlapCheck = (payload.patient || payload.startTime || payload.endTime);
  if (needsOverlapCheck) {
    const patientId = payload.patient || originalAppointment.patient;
    const s = payload.startTime || originalAppointment.startTime;
    const e = payload.endTime || originalAppointment.endTime;

    const overlap = await hasOverlap({ clinicId, patientId, startTime: s, endTime: e, ignoreId: id });
    if (overlap) {
      return res.status(400).json({ message: 'Conflito de horário: já existe consulta nesse intervalo.' });
    }
  }

  if (payload.reminderEnabled) {
    payload.reminderEnabled = {
      oneDayBefore:     payload.reminderEnabled.oneDayBefore     ?? originalAppointment.reminderEnabled?.oneDayBefore ?? false,
      twoHoursBefore:   payload.reminderEnabled.twoHoursBefore   ?? originalAppointment.reminderEnabled?.twoHoursBefore ?? false,
      threeMinutesBefore: payload.reminderEnabled.threeMinutesBefore ?? originalAppointment.reminderEnabled?.threeMinutesBefore ?? false,
    };
  }

  const updatedAppointment = await Appointment.findOneAndUpdate(
    { _id: id, clinic: clinicId },
    payload,
    { new: true, runValidators: true, omitUndefined: true }
  ).lean();

  // --- Log de Auditoria (Atualização) ---
  const diffDetails = auditLogService.generateDiffDetails(
    originalAppointment,
    updatedAppointment,
    fieldsToTrack
  );

  const statusChanged = diffDetails.changes.find(c => c.field === 'status');
  const action = statusChanged 
    ? 'APPOINTMENT_STATUS_CHANGE' 
    : 'APPOINTMENT_UPDATE';

  await auditLogService.createLog(
    req.user._id,
    req.clinicId,
    action,
    'Appointment',
    updatedAppointment._id,
    diffDetails
  );
  // --- Fim do Log ---

  // --- GATILHO DE NOTIFICAÇÃO (REMOVIDO DAQUI) ---
  // A lógica de notificação foi movida para o 'createAppointment'
  // para disparar no momento do agendamento, e não na confirmação.
  // --- FIM DO GATILHO ---

  return res.status(200).json(updatedAppointment);
});

// ---------------------------------------------------------
// @desc    Reagendar um atendimento
// ---------------------------------------------------------
exports.rescheduleAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clinicId = req.clinicId;
  const {
    startTime,
    endTime,
    notes,
    appendNotes,
    sendReminder,
    reminderEnabled,
    resetStatus = true,
  } = req.body || {};

  if (!startTime || !endTime) {
    return res.status(400).json({ message: 'startTime e endTime são obrigatórios para reagendar.' });
  }
  
  const fieldsToTrack = [
    'startTime',
    'endTime',
    'notes',
    'status',
    'sendReminder',
    'reminderEnabled.oneDayBefore',
    'reminderEnabled.twoHoursBefore',
    'reminderEnabled.threeMinutesBefore',
  ];

  const current = await Appointment.findOne({ _id: id, clinic: clinicId }).lean();
  if (!current) return res.status(404).json({ message: 'Agendamento não encontrado nesta clínica.' });

  const allowedStatuses = ['Agendado', 'Confirmado'];
  if (!allowedStatuses.includes(current.status)) {
    return res.status(400).json({ message: `Não é possível reagendar um atendimento com status "${current.status}".` });
  }

  const start = parseToUTC(startTime);
  const end = parseToUTC(endTime);
  if (!start || !end) return res.status(400).json({ message: 'Datas inválidas.' });
  if (end <= start) return res.status(400).json({ message: 'endTime deve ser maior que startTime.' });

  const overlap = await hasOverlap({
    clinicId,
    patientId: current.patient,
    startTime: start,
    endTime: end,
    ignoreId: id,
  });
  if (overlap) return res.status(400).json({ message: 'Conflito de horário: já existe consulta nesse intervalo.' });

  const update = { startTime: start, endTime: end };
  if (resetStatus) update.status = 'Agendado';

  if (typeof sendReminder === 'boolean') {
    update.sendReminder = sendReminder;
  }

  if (reminderEnabled && typeof reminderEnabled === 'object') {
    update.reminderEnabled = {
      oneDayBefore:       reminderEnabled.oneDayBefore       ?? current.reminderEnabled?.oneDayBefore ?? false,
      twoHoursBefore:     reminderEnabled.twoHoursBefore     ?? current.reminderEnabled?.twoHoursBefore ?? false,
      threeMinutesBefore: reminderEnabled.threeMinutesBefore ?? current.reminderEnabled?.threeMinutesBefore ?? false,
    };
  }

  // Reseta flags de envio de lembrete
  update.remindersSent = { oneDayBefore: false, twoHoursBefore: false, threeMinutesBefore: false };

  if (typeof notes === 'string') {
    update.notes = notes.trim();
  } else if (typeof appendNotes === 'string' && appendNotes.trim()) {
    const sep = current.notes ? '\n' : '';
    update.notes = `${current.notes || ''}${sep}${appendNotes.trim()}`;
  }

  const updated = await Appointment.findOneAndUpdate(
    { _id: id, clinic: clinicId },
    update,
    { new: true, runValidators: true }
  )
    .populate('patient', 'name phone')
    .lean();

  // --- Log de Auditoria (Reagendamento) ---
  const diffDetails = auditLogService.generateDiffDetails(
    current,
    updated,
    fieldsToTrack
  );

  await auditLogService.createLog(
    req.user._id,
    req.clinicId,
    'APPOINTMENT_RESCHEDULE',
    'Appointment',
    updated._id,
    diffDetails
  );
  // --- Fim do Log ---

  return res.status(200).json(updated);
});

// ---------------------------------------------------------
// @desc    Deletar (cancelar) um agendamento
// ---------------------------------------------------------
exports.deleteAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clinicId = req.clinicId;

  const deletedAppointment = await Appointment.findOneAndDelete({ _id: id, clinic: clinicId });

  if (!deletedAppointment) {
    return res.status(404).json({ message: 'Agendamento não encontrado para exclusão.' });
á  }

  // --- Log de Auditoria (Deleção) ---
  await auditLogService.createLog(
    req.user._id,
    req.clinicId,
    'APPOINTMENT_DELETE',
    'Appointment',
    deletedAppointment._id,
    { 
      summary: 'Agendamento deletado',
      changes: [
        { field: 'patient', old: deletedAppointment.patient, new: null },
        { field: 'status', old: deletedAppointment.status, new: null },
      ]
    }
  );
  // --- Fim do Log ---

  return res.status(204).send();
});

// ---------------------------------------------------------
// @desc    Verificar se há conflito de horário
// @route   GET /api/appointments/check-conflict
// @access  Private (Requer clínica)
// ---------------------------------------------------------
exports.checkConflict = asyncHandler(async (req, res) => {
  const { patientId, startTime, endTime, ignoreId } = req.query;
  const clinicId = req.clinicId;

  if (!patientId || !startTime || !endTime) {
    return res.status(400).json({ 
      message: 'patientId, startTime e endTime são obrigatórios na query string.' 
    });
  }

  const start = parseToUTC(startTime);
  const end = parseToUTC(endTime);

  if (!start || !end) {
    return res.status(400).json({ 
      message: 'Datas inválidas. Use formato ISO válido (ex: 2024-10-30T14:00:00.000-03:00).' 
    });
  }
  if (end <= start) {
    return res.status(400).json({ message: 'endTime deve ser maior que startTime.' });
  }

  const conflict = await hasOverlap({
    clinicId,
    patientId,
    startTime: start,
    endTime: end,
    ignoreId: ignoreId || null,
  });

  if (conflict) {
    return res.status(200).json({ 
      conflict: true, 
      message: 'Já existe um agendamento neste horário para o paciente.' 
    });
  }

  return res.status(200).json({ conflict: false });
});

// ---------------------------------------------------------
// @desc    Listar todos os agendamentos de um paciente
// ---------------------------------------------------------
exports.getAppointmentsByPatient = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const clinicId = req.clinicId;

  const patientExists = await Patient.exists({ _id: patientId, clinicId });
  if (!patientExists) {
    return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });
  }

  // Atualiza status para 'Não Compareceu'
  const now = new Date();
  const twoHoursInMs = 2 * 60 * 60 * 1000;
  const cutoffTime = new Date(now.getTime() - twoHoursInMs);

  await Appointment.updateMany(
    { clinic: clinicId, patient: patientId, status: 'Agendado', endTime: { $lt: cutoffTime } },
    { $set: { status: 'Não Compareceu' } }
  );

  const appointments = await Appointment.find({ patient: patientId, clinic: clinicId })
    .sort({ startTime: -1 })
    .lean();

  return res.status(200).json(appointments);
});
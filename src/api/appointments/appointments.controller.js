// api/appointments/appointments.controller.js
const Appointment = require('./appointments.model');
const Patient = require('../patients/patients.model');
const asyncHandler = require('../../utils/asyncHandler');
const { DateTime } = require('luxon');
// Importa o novo serviço de auditoria
const auditLogService = require('../audit/audit-log.service');

const BR_TZ = 'America/Sao_Paulo';

// ----------------- helpers -----------------
const parseToUTC = (value) => {
  if (!value) return null;
  // interpreta horário local de Brasília e converte pra UTC
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
    remindersSent,
  } = body || {};
  return { patient, startTime, endTime, notes, status, returnInDays, sendReminder, remindersSent };
};

// ---------------------------------------------------------
// @desc    Criar (agendar) uma nova consulta
// ---------------------------------------------------------
exports.createAppointment = asyncHandler(async (req, res) => {
  const { patient, startTime, endTime, notes, status, returnInDays, sendReminder } = req.body;
  const clinicId = req.clinicId;

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

  const newAppointment = await Appointment.create({
    patient,
    startTime: start,
    endTime: end,
    notes,
    status,
    returnInDays,
    sendReminder,
    clinic: clinicId,
  });

  // --- Log de Auditoria (Criação) ---
  await auditLogService.createLog(
    req.user._id,
    req.clinicId,
    'APPOINTMENT_CREATE',
    'Appointment',
    newAppointment._id,
    {
      summary: 'Agendamento criado',
      changes: [ // Loga os valores iniciais como "novos"
        { field: 'status', old: null, new: newAppointment.status },
        { field: 'patient', old: null, new: newAppointment.patient },
        { field: 'startTime', old: null, new: newAppointment.startTime },
      ]
    }
  );
  // --- Fim do Log ---

  return res.status(201).json(newAppointment);
});

// ---------------------------------------------------------
// @desc    Listar todas as consultas (base do calendário)
// ---------------------------------------------------------
exports.getAllAppointments = asyncHandler(async (req, res) => {
  let { startDate, endDate } = req.query;

  let startUTC, endUTC;

  if (!startDate || !endDate) {
    // usa hoje em horário de Brasília
    startUTC = DateTime.now().setZone(BR_TZ).startOf('day').toUTC().toJSDate();
    endUTC   = DateTime.now().setZone(BR_TZ).endOf('day').toUTC().toJSDate();
  } else {
    const sInTZ = DateTime.fromISO(startDate, { zone: BR_TZ }).startOf('day');
    const eInTZ = DateTime.fromISO(endDate, { zone: BR_TZ }).endOf('day');
    if (!sInTZ.isValid || !eInTZ.isValid) {
      return res.status(400).json({ message: 'Datas inválidas.' });
    }
    startUTC = sInTZ.toUTC().toJSDate();
    endUTC   = eInTZ.toUTC().toJSDate();
  }

  // Atualiza status de "Não Compareceu" para consultas passadas
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
// @desc    Atualizar um agendamento existente
// ---------------------------------------------------------
exports.updateAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clinicId = req.clinicId;

  const payload = pickUpdateFields(req.body);

  // Campos que queremos rastrear no log
  const fieldsToTrack = [
    'patient',
    'startTime',
    'endTime',
    'notes',
    'status',
    'returnInDays',
    'sendReminder'
  ];

  // Buscar o estado ORIGINAL (antes de atualizar)
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

  // Executar a atualização
  const updatedAppointment = await Appointment.findOneAndUpdate(
    { _id: id, clinic: clinicId },
    payload,
    { new: true, runValidators: true, omitUndefined: true }
  ).lean(); // .lean() para pegar o objeto puro

  // --- Log de Auditoria (Atualização) ---
  // Gerar o diff
  const diffDetails = auditLogService.generateDiffDetails(
    originalAppointment,
    updatedAppointment,
    fieldsToTrack
  );

  // Determinar a ação correta
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
    diffDetails // Passa o objeto de 'changes'
  );
  // --- Fim do Log ---

  return res.status(200).json(updatedAppointment);
});

// ---------------------------------------------------------
// @desc    Reagendar um atendimento
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
    resetStatus = true,
  } = req.body || {};

  if (!startTime || !endTime) {
    return res.status(400).json({ message: 'startTime e endTime são obrigatórios para reagendar.' });
  }
  
  // Campos que queremos rastrear
  const fieldsToTrack = [
    'startTime',
    'endTime',
    'notes',
    'status',
    'sendReminder'
  ];

  // Buscar o estado ORIGINAL
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
    update.remindersSent = { oneDayBefore: false, threeHoursBefore: false };
  }

  if (typeof notes === 'string') {
    update.notes = notes.trim();
  } else if (typeof appendNotes === 'string' && appendNotes.trim()) {
    const sep = current.notes ? '\n' : '';
    update.notes = `${current.notes || ''}${sep}${appendNotes.trim()}`;
  }

  // Executar a atualização
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
// @desc    Deletar (cancelar) um agendamento
// ---------------------------------------------------------
exports.deleteAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clinicId = req.clinicId;

  const deletedAppointment = await Appointment.findOneAndDelete({ _id: id, clinic: clinicId });

  if (!deletedAppointment) {
    return res.status(404).json({ message: 'Agendamento não encontrado para exclusão.' });
  }

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
// @desc    Listar todos os agendamentos de um paciente
// ---------------------------------------------------------
exports.getAppointmentsByPatient = asyncHandler(async (req, res) => {
  const { patientId } = req.params;
  const clinicId = req.clinicId;

  const patientExists = await Patient.exists({ _id: patientId, clinicId });
  if (!patientExists) {
    return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });
  }

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
// api/appointments/appointments.controller.js
const Appointment = require('./appointments.model');
const Patient = require('../patients/patients.model');
const asyncHandler = require('../../utils/asyncHandler');

// ----------------- helpers -----------------
const parseDateSafe = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const ensurePatientInClinic = async (patientId, clinicId) => {
  const exists = await Patient.exists({ _id: patientId, clinicId, deletedAt: { $exists: false } });
  return !!exists;
};

const hasOverlap = async ({ clinicId, patientId, startTime, endTime, ignoreId = null }) => {
  const criteria = {
    clinic: clinicId,
    patient: patientId,
    // overlap rule: (start < existing.end) AND (end > existing.start)
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
// @route   POST /api/appointments
// @access  Private
// ---------------------------------------------------------
exports.createAppointment = asyncHandler(async (req, res) => {
  const { patient, startTime, endTime, notes, status, returnInDays, sendReminder } = req.body;
  const clinicId = req.clinicId;

  if (!patient || !startTime || !endTime) {
    return res.status(400).json({ message: 'Paciente, data de início e data de fim são obrigatórios.' });
  }

  const start = parseDateSafe(startTime);
  const end = parseDateSafe(endTime);
  if (!start || !end) {
    return res.status(400).json({ message: 'Datas inválidas. Use um formato ISO válido.' });
  }
  if (end <= start) {
    return res.status(400).json({ message: 'endTime deve ser maior que startTime.' });
  }

  // paciente precisa pertencer à clínica
  const ok = await ensurePatientInClinic(patient, clinicId);
  if (!ok) {
    return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });
  }

  // conflito de horário (mesmo paciente, mesma clínica)
  const overlap = await hasOverlap({ clinicId, patientId: patient, startTime: start, endTime: end });
  if (overlap) {
    return res.status(400).json({ message: 'Conflito de horário: já existe consulta nesse intervalo.' });
  }

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

  return res.status(201).json(newAppointment);
});


// ---------------------------------------------------------
// @desc    Listar todas as consultas (base do calendário)
// @route   GET /api/appointments
// @access  Private
// ---------------------------------------------------------
function parseDateUTC(value) {
  const [y,m,d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m-1, d)); // 00:00 UTC
}

exports.getAllAppointments = asyncHandler(async (req, res) => {
  let { startDate, endDate } = req.query;

  let start, end;

  if (!startDate || !endDate) {
    const now = new Date();
    // pega data de hoje em UTC
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    end   = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  } else {
    start = parseDateUTC(startDate);
    end   = parseDateUTC(endDate);
    if (!start || !end) {
      return res.status(400).json({ message: 'Datas inválidas.' });
    }
    end.setUTCHours(23,59,59,999);
  }

  // Atualiza o status de agendamentos passados para "Não Compareceu"
  const now = new Date();
  const twoHoursInMs = 2 * 60 * 60 * 1000;
  const cutoffTime = new Date(now.getTime() - twoHoursInMs);

  await Appointment.updateMany(
    {
      clinic: req.clinicId,
      status: 'Agendado',
      endTime: { $lt: cutoffTime },
    },
    {
      $set: { status: 'Não Compareceu' },
    }
  );

  const filter = {
    clinic: req.clinicId,
    startTime: { $gte: start, $lte: end },
  };

  const appointments = await Appointment.find(filter)
    .populate('patient', 'name phone')
    .sort({ startTime: 1 })
    .lean();

  return res.status(200).json(appointments);
});

// ---------------------------------------------------------
// @desc    Atualizar um agendamento existente
// @route   PUT /api/appointments/:id
// @access  Private
// ---------------------------------------------------------
exports.updateAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clinicId = req.clinicId;

  const payload = pickUpdateFields(req.body);

  // validações coerentes com criação (quando os campos vierem)
  let start, end;
  if (payload.startTime) {
    start = parseDateSafe(payload.startTime);
    if (!start) return res.status(400).json({ message: 'startTime inválido.' });
    payload.startTime = start;
  }
  if (payload.endTime) {
    end = parseDateSafe(payload.endTime);
    if (!end) return res.status(400).json({ message: 'endTime inválido.' });
    payload.endTime = end;
  }
  if (start && end && end <= start) {
    return res.status(400).json({ message: 'endTime deve ser maior que startTime.' });
  }

  // se trocar paciente, garanta vínculo com a clínica
  if (payload.patient) {
    const ok = await ensurePatientInClinic(payload.patient, clinicId);
    if (!ok) return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });
  }

  // checa conflito somente se algum entre start/end/patient mudar
  const needsOverlapCheck = (payload.patient || payload.startTime || payload.endTime);
  if (needsOverlapCheck) {
    // precisamos dos valores “atuais” para compor a verificação completa
    const current = await Appointment.findOne({ _id: id, clinic: clinicId }).select('patient startTime endTime').lean();
    if (!current) return res.status(404).json({ message: 'Agendamento não encontrado nesta clínica.' });

    const patientId = payload.patient || current.patient;
    const s = payload.startTime || current.startTime;
    const e = payload.endTime || current.endTime;

    const overlap = await hasOverlap({ clinicId, patientId, startTime: s, endTime: e, ignoreId: id });
    if (overlap) {
      return res.status(400).json({ message: 'Conflito de horário: já existe consulta nesse intervalo.' });
    }
  }

  const updatedAppointment = await Appointment.findOneAndUpdate(
    { _id: id, clinic: clinicId },
    payload,
    { new: true, runValidators: true, omitUndefined: true }
  );

  if (!updatedAppointment) {
    return res.status(404).json({ message: 'Agendamento não encontrado nesta clínica.' });
  }

  return res.status(200).json(updatedAppointment);
});

// ---------------------------------------------------------
// @desc    Deletar (cancelar) um agendamento
// @route   DELETE /api/appointments/:id
// @access  Private
// ---------------------------------------------------------
exports.deleteAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const clinicId = req.clinicId;

  const deletedAppointment = await Appointment.findOneAndDelete({ _id: id, clinic: clinicId });

  if (!deletedAppointment) {
    return res.status(404).json({ message: 'Agendamento não encontrado para exclusão.' });
  }

  return res.status(204).send();
});

// ---------------------------------------------------------
// @desc    Listar todos os agendamentos de um paciente
// @route   GET /api/appointments/patient/:patientId
// @access  Private
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
    {
      clinic: clinicId,
      patient: patientId,
      status: 'Agendado',
      endTime: { $lt: cutoffTime },
    },
    {
      $set: { status: 'Não Compareceu' },
    }
  );

  const appointments = await Appointment.find({
    patient: patientId,
    clinic: clinicId,
  })
  .sort({ startTime: -1 }) // Ordena do mais recente para o mais antigo
  .lean();

  return res.status(200).json(appointments);
});
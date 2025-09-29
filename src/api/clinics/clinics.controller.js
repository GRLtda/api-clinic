const Clinic = require('./clinics.model');
const Patient = require('../patients/patients.model');
const Appointment = require('../appointments/appointments.model');
const asyncHandler = require('../../utils/asyncHandler');

// helpers: whitelists de campos permitidos
const pickCreateFields = (body) => {
  const {
    name,
    cnpj,
    logoUrl,
    marketingName,
    responsibleName,
    address,
    workingHours,
    plan,
  } = body || {};
  return { name, cnpj, logoUrl, marketingName, responsibleName, address, workingHours, plan };
};

const pickUpdateFields = (body) => {
  const {
    name,
    cnpj,
    logoUrl,
    marketingName,
    responsibleName,
    address,
    workingHours,
    plan,
  } = body || {};
  return { name, cnpj, logoUrl, marketingName, responsibleName, address, workingHours, plan };
};

// @desc    Criar a clínica para o usuário logado
// @route   POST /api/clinics
// @access  Private
exports.createClinic = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // checa se já existe clínica para o owner
  const existingClinic = await Clinic.findOne({ owner: userId }).select('_id').lean();
  if (existingClinic) {
    return res.status(400).json({ message: 'Este usuário já possui uma clínica configurada.' });
  }

  // impede override de owner pelo body e aplica whitelist
  const clinicData = { ...pickCreateFields(req.body), owner: userId };

  // validação mínima de obrigatórios sem mudar contrato de mensagem
  if (!clinicData.name || !clinicData.responsibleName) {
    return res.status(400).json({ message: 'Nome da clínica e responsável são obrigatórios.' });
  }

  const newClinic = await Clinic.create(clinicData);
  // mantém a mesma resposta: documento da clínica criada
  return res.status(201).json(newClinic);
});

// @desc    Atualizar configurações da clínica do usuário
// @route   PUT /api/clinics
// @access  Private
exports.updateClinic = asyncHandler(async (req, res) => {
  const clinicId = req.clinicId;

  // apenas campos permitidos; não deixa alterar owner
  const updateData = pickUpdateFields(req.body);

  const updatedClinic = await Clinic.findOneAndUpdate(
    { _id: clinicId },
    updateData,
    {
      new: true,
      runValidators: true,
      // evita setar undefined e sobrescrever campos involuntariamente
      omitUndefined: true,
    }
  );

  if (!updatedClinic) {
    return res.status(404).json({ message: 'Clínica não encontrada.' });
  }

  return res.status(200).json(updatedClinic);
});

exports.getClinicSummary = asyncHandler(async (req, res) => {
    const clinicId = req.clinicId;

    // Datas para filtrar "hoje"
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Contagem total de pacientes (como antes)
    const totalPatientsPromise = Patient.countDocuments({ clinicId: clinicId });

    // 2. Busca dos agendamentos de hoje (a nova parte)
    const todaysAppointmentsPromise = Appointment.find({
        clinic: clinicId,
        startTime: {
            $gte: startOfDay,
            $lte: endOfDay,
        },
    })
    .populate('patient', 'name phone') // Inclui nome e telefone do paciente
    .sort({ startTime: 1 }) // Ordena por hora de início
    .lean();

    // Executa as duas buscas no banco de dados em paralelo para mais eficiência
    const [totalPatients, todaysAppointments] = await Promise.all([
        totalPatientsPromise,
        todaysAppointmentsPromise,
    ]);

    // O número de agendamentos é simplesmente o tamanho do array
    const appointmentsTodayCount = todaysAppointments.length;

    res.status(200).json({
        totalPatients,
        appointmentsToday: appointmentsTodayCount,
        todaysAppointments: todaysAppointments, // A lista completa dos agendamentos
    });
});
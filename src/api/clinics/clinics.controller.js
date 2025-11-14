const Clinic = require('./clinics.model');
const Patient = require('../patients/patients.model');
const Appointment = require('../appointments/appointments.model');
const asyncHandler = require('../../utils/asyncHandler');
const auditLogService = require('../audit/audit-log.service');
const AdminInvitation = require('../../admin/invitations/admin.invitation.model');

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
    allowAppointmentsOutsideWorkingHours,
  } = body || {};
  return { name, cnpj, logoUrl, marketingName, responsibleName, address, workingHours, plan, allowAppointmentsOutsideWorkingHours };
};

// @desc    Criar a clínica para o usuário logado
// @route   POST /api/clinics
// @access  Private
exports.createClinic = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const userEmail = req.user.email;

  const existingClinic = await Clinic.findOne({ owner: userId }).select('_id').lean();
  if (existingClinic) {
    return res.status(400).json({ message: 'Este usuário já possui uma clínica configurada.' });
  }

  const invitation = await AdminInvitation.findOne({
    email: userEmail,
    status: 'accepted'
  }).select('plan').lean();

  const clinicPlan = (invitation && invitation.plan) ? invitation.plan : 'basic';

  const clinicDataFromRequest = pickCreateFields(req.body);
  
  const clinicData = { 
    ...clinicDataFromRequest, 
    owner: userId,
    plan: clinicPlan
  };

  if (!clinicData.name || !clinicData.responsibleName) {
    return res.status(400).json({ message: 'Nome da clínica e responsável são obrigatórios.' });
  }

  const newClinic = await Clinic.create(clinicData);
  return res.status(201).json(newClinic);
});

// @desc    Atualizar configurações da clínica do usuário
// @route   PUT /api/clinics
// @access  Private
exports.updateClinic = asyncHandler(async (req, res) => {
  const clinicId = req.clinicId;
  const updateData = pickUpdateFields(req.body);

  // 1. Campos que queremos rastrear no log
  const fieldsToTrack = [
    'name',
    'cnpj',
    'logoUrl',
    'marketingName',
    'responsibleName',
    'address.cep',
    'address.street',
    'address.number',
    'address.district',
    'address.complement',
    'address.city',
    'address.state',
    'allowAppointmentsOutsideWorkingHours'
  ];

  // 2. Buscar o estado ORIGINAL (antes de atualizar)
  const originalClinic = await Clinic.findOne({ _id: clinicId }).lean();
  if (!originalClinic) {
    return res.status(404).json({ message: 'Clínica não encontrada.' });
  }

  // 3. Executar a atualização
  const updatedClinic = await Clinic.findOneAndUpdate(
    { _id: clinicId },
    updateData,
    { new: true, runValidators: true, omitUndefined: true }
  ).lean(); // Usamos .lean() para obter um objeto JS puro

  // 4. Gerar o diff e salvar o log
  const diffDetails = auditLogService.generateDiffDetails(
    originalClinic,
    updatedClinic,
    fieldsToTrack
  );

  await auditLogService.createLog(
    req.user._id,
    req.clinicId,
    'CLINIC_UPDATE',
    'Clinic',
    updatedClinic._id,
    diffDetails // Passa o objeto de 'changes'
  );

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
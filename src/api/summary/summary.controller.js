// src/api/summary/summary.controller.js
const asyncHandler = require('../../utils/asyncHandler');
const AnamnesisResponse = require('../anamnesis/anamnesis-response.model');
const Appointment = require('../appointments/appointments.model');
const Patient = require('../patients/patients.model');
const { DateTime } = require('luxon');

const BR_TZ = 'America/Sao_Paulo';

/**
 * @desc    Retorna o dashboard geral da clínica (KPIs + Feed)
 * @route   GET /api/summary
 * @access  Private (Require Clinic)
 */
exports.getClinicDashboard = asyncHandler(async (req, res) => {
  const clinicId = req.clinicId;
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // Janeiro é 0 no JS, mas 1 no Mongo ($month)

  // Definição do início e fim do dia para contagens
  const startOfDay = DateTime.now().setZone(BR_TZ).startOf('day').toUTC().toJSDate();
  const endOfDay = DateTime.now().setZone(BR_TZ).endOf('day').toUTC().toJSDate();

  // --- 1. Executar contagens e buscas em paralelo ---
  const [
    pendingAnamnesisCount,
    appointmentsTodayCount,
    totalPatientsCount,
    birthdaysMonthCount, // <--- NOVO KPI
    recentAnamneses,
    upcomingAppointments,
    newPatients
  ] = await Promise.all([
    // KPI: Anamneses Pendentes
    AnamnesisResponse.countDocuments({
      clinic: clinicId,
      status: 'Pendente'
    }),

    // KPI: Agendamentos Hoje (que não foram cancelados)
    Appointment.countDocuments({
      clinic: clinicId,
      startTime: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: 'Cancelado' }
    }),

    // KPI: Total de Pacientes Ativos
    Patient.countDocuments({
      clinicId: clinicId,
      deletedAt: { $exists: false }
    }),

    // KPI: Aniversariantes do Mês (NOVO)
    Patient.countDocuments({
      clinicId: clinicId,
      deletedAt: { $exists: false },
      $expr: { $eq: [{ $month: '$birthDate' }, currentMonth] } // Compara apenas o mês
    }),

    // FEED: Últimas Anamneses Respondidas (Preenchidas)
    AnamnesisResponse.find({
      clinic: clinicId,
      status: 'Preenchido'
    })
      .sort({ updatedAt: -1 })
      .limit(5)
      .populate('patient', 'name')
      .populate('template', 'name')
      .lean(),

    // FEED: Próximos Agendamentos (Avisos imediatos)
    Appointment.find({
      clinic: clinicId,
      startTime: { $gte: now },
      status: { $in: ['Agendado', 'Confirmado'] }
    })
      .sort({ startTime: 1 })
      .limit(5)
      .populate('patient', 'name')
      .lean(),

    // FEED: Novos Pacientes Cadastrados
    Patient.find({
      clinicId: clinicId,
      deletedAt: { $exists: false }
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('name createdAt')
      .lean()
  ]);

  // --- 2. Construção do "Feed de Atualizações" unificado ---
  const feed = [];

  // Adiciona Anamneses ao feed
  recentAnamneses.forEach(item => {
    feed.push({
      type: 'ANAMNESIS_FILLED',
      title: 'Anamnese Respondida',
      description: `${item.patient?.name || 'Paciente'} respondeu "${item.template?.name}"`,
      date: item.updatedAt,
      id: item._id,
      entityId: item.patient?._id
    });
  });

  // Adiciona Agendamentos ao feed
  upcomingAppointments.forEach(item => {
    const time = DateTime.fromJSDate(item.startTime).setZone(BR_TZ).toFormat('HH:mm');
    const date = DateTime.fromJSDate(item.startTime).setZone(BR_TZ).toFormat('dd/MM');

    feed.push({
      type: 'UPCOMING_APPOINTMENT',
      title: 'Consulta Agendada',
      description: `${item.patient?.name} - ${date} às ${time}`,
      date: item.startTime,
      id: item._id,
      entityId: item.patient?._id,
      highlight: true
    });
  });

  // Adiciona Novos Pacientes ao feed
  newPatients.forEach(item => {
    feed.push({
      type: 'NEW_PATIENT',
      title: 'Novo Paciente',
      description: `${item.name} foi cadastrado`,
      date: item.createdAt,
      id: item._id,
      entityId: item._id
    });
  });

  // Ordena o feed
  feed.sort((a, b) => new Date(b.date) - new Date(a.date));

  // --- 3. Montar objeto de Avisos/Alertas ---
  const alerts = [];

  if (pendingAnamnesisCount > 0) {
    alerts.push({
      level: 'warning',
      message: `Existem ${pendingAnamnesisCount} anamneses pendentes.`
    });
  }

  if (birthdaysMonthCount > 0) {
    alerts.push({
      level: 'info',
      message: `🎉 ${birthdaysMonthCount} paciente(s) fazem aniversário este mês!`
    });
  }

  // Retorno Final
  res.status(200).json({
    stats: {
      pendingAnamnesis: pendingAnamnesisCount,
      appointmentsToday: appointmentsTodayCount,
      totalPatients: totalPatientsCount,
      birthdaysMonth: birthdaysMonthCount // <--- Adicionado ao objeto de retorno
    },
    alerts: alerts,
    feed: feed.slice(0, 20)
  });
});
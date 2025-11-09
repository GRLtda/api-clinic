// src/admin/dashboard/admin.dashboard.controller.js
const Clinic = require('../../api/clinics/clinics.model');
const User = require('../../api/users/users.model');
const Patient = require('../../api/patients/patients.model');
const Appointment = require('../../api/appointments/appointments.model');
const asyncHandler = require('../../utils/asyncHandler');

// Importa o novo helper de filtro
const { getDateRangeFromFilter } = require('../utils/dateFilter.helper');

/**
 * Helper para buscar dados de novos registros (Clínicas, Pacientes)
 * por período.
 */
const getNewRegistrations = async (model, { startDate, groupByFormat, periodUnit }, additionalMatch = {}) => {
  
  let idFormat;
  let dateLabel;

  // Define o formato de agrupamento e label dinamicamente
  if (periodUnit === 'day') {
    // Agrupa por dia (ex: "2025-11-09")
    idFormat = { $dateToString: { format: groupByFormat, date: "$createdAt" } };
    dateLabel = "$_id";
  } else { 
    // Agrupa por mês (ex: "11/2025")
    idFormat = {
      year: { $year: '$createdAt' },
      month: { $month: '$createdAt' }
    };
    dateLabel = {
      $concat: [
        { $toString: '$_id.month' },
        '/',
        { $toString: '$_id.year' }
      ]
    };
  }

  try {
    const data = await model.aggregate([
      {
        // 1. Filtra pelo período e condições extras (ex: não deletado)
        $match: {
          createdAt: { $gte: startDate },
          ...additionalMatch,
        },
      },
      {
        // 2. Agrupa pelo formato (dia ou mês)
        $group: {
          _id: idFormat,
          count: { $sum: 1 },
        },
      },
      // 3. Ordena cronologicamente
      { $sort: { _id: 1 } },
      {
        // 4. Formata a saída
        $project: {
          _id: 0,
          dateLabel: dateLabel,
          count: 1,
        },
      },
    ]);
    return data;
  } catch (error) {
    console.error(`Erro ao agregar ${model.modelName}:`, error);
    return [];
  }
};

/**
 * Helper para buscar a distribuição de status de agendamentos
 * (Agendamentos CRIADOS no período)
 */
const getAppointmentStatusDistribution = async (startDate) => {
  try {
    const data = await Appointment.aggregate([
      {
        // Filtra agendamentos criados *dentro* do período
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        // Agrupa por 'status' e conta
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
      {
        // Formata a saída
        $project: {
          _id: 0,
          status: '$_id',
          count: 1,
        },
      },
      { $sort: { status: 1 } } // Ordena por nome do status
    ]);
    return data;
  } catch (error) {
    console.error(`Erro ao agregar Agendamentos:`, error);
    return [];
  }
};


/**
 * @desc    Obter resumo de estatísticas do sistema (Admin)
 * @route   GET /api/admin/summary
 * @access  Private (Admin)
 */
exports.getAdminSummary = asyncHandler(async (req, res) => {
  
  // Pega o filtro da query (ex: ?period=7d), default '12m'
  const periodFilter = req.query.period || '12m';
  
  // Calcula o range e o formato de group-by
  const { startDate, groupByFormat, periodUnit } = getDateRangeFromFilter(periodFilter);

  // Executa todas as consultas em paralelo
  const [
    // KPIs Totais (All-Time)
    totalClinics,
    totalUsers,
    totalPatients,
    totalAppointments,
    
    // Gráficos (Filtrados por período)
    newClinicsChart,
    newPatientsChart,
    appointmentStatusChart
  ] = await Promise.all([
    // Contagens totais (não são afetadas pelo filtro)
    Clinic.countDocuments(),
    User.countDocuments(),
    Patient.countDocuments({ deletedAt: { $exists: false } }),
    Appointment.countDocuments(),
    
    // Dados para gráficos (são afetados pelo filtro)
    getNewRegistrations(Clinic, { startDate, groupByFormat, periodUnit }),
    getNewRegistrations(Patient, { startDate, groupByFormat, periodUnit }, { deletedAt: { $exists: false } }),
    getAppointmentStatusDistribution(startDate) // Filtra status de agendamentos criados no período
  ]);

  // Retorna os dados agrupados
  res.status(200).json({
    // Totais (KPIs principais "all-time")
    totals: {
      totalClinics,
      totalUsers,
      totalPatients,
      totalAppointments,
    },
    // Dados para os gráficos (filtrados)
    charts: {
      period: periodFilter, // Informa ao frontend qual filtro está ativo
      newClinicsPerPeriod: newClinicsChart,
      newPatientsPerPeriod: newPatientsChart,
      appointmentStatusDistribution: appointmentStatusChart,
    }
  });
});
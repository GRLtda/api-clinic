const Appointment = require('./appointments.model');

/**
 * @desc    Criar (agendar) uma nova consulta
 * @route   POST /api/appointments
 * @access  Private
 */
exports.createAppointment = async (req, res) => {
  try {
    // Pega os dados do corpo da requisição
    const { patient, startTime, endTime, notes, status, returnInDays, sendReminder } = req.body;
    
    // Pega o ID da clínica do middleware (garantindo que o agendamento é para a clínica certa)
    const clinicId = req.clinicId;

    // Validação básica
    if (!patient || !startTime || !endTime) {
        return res.status(400).json({ message: 'Paciente, data de início e data de fim são obrigatórios.' });
    }

    const newAppointment = await Appointment.create({
      patient,
      startTime,
      endTime,
      notes,
      status,
      returnInDays,
      sendReminder,
      clinic: clinicId, // Associa à clínica do usuário logado
    });

    res.status(201).json(newAppointment);

  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar agendamento', error: error.message });
  }
};

/**
 * @desc    Listar todas as consultas (base do calendário)
 * @route   GET /api/appointments
 * @access  Private
 */
exports.getAllAppointments = async (req, res) => {
  try {
    // Pega as datas de início e fim da query string para filtrar o período
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Os parâmetros startDate e endDate são obrigatórios.' });
    }

    // Monta o filtro da busca no banco de dados
    const filter = {
      clinic: req.clinicId, // Apenas agendamentos da clínica do usuário
      startTime: {
        $gte: new Date(startDate), // $gte = Greater Than or Equal (Maior ou igual a)
        $lte: new Date(endDate),   // $lte = Less Than or Equal (Menor ou igual a)
      }
    };

    const appointments = await Appointment.find(filter)
      // O .populate é muito poderoso! Ele substitui o ID do paciente pelos dados reais do paciente.
      // Aqui, estamos pedindo para trazer apenas o nome e o telefone do paciente.
      .populate('patient', 'name phone')
      .sort({ startTime: 'asc' }); // Ordena os resultados por data de início

    res.status(200).json(appointments);

  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar agendamentos', error: error.message });
  }
};


/**
 * @desc    Atualizar um agendamento existente
 * @route   PUT /api/appointments/:id
 * @access  Private
 */
exports.updateAppointment = async (req, res) => {
  try {
    const { id } = req.params; // Pega o ID do agendamento da URL
    const clinicId = req.clinicId; // Pega o ID da clínica do middleware

    // Tenta encontrar e atualizar o agendamento
    // A condição de busca { _id: id, clinic: clinicId } garante que um médico
    // só possa alterar agendamentos da sua própria clínica.
    const updatedAppointment = await Appointment.findOneAndUpdate(
      { _id: id, clinic: clinicId },
      req.body, // Os novos dados vêm do corpo da requisição
      {
        new: true, // Retorna o documento já com as alterações
        runValidators: true, // Roda as validações do nosso Schema
      }
    );

    // Se não encontrou o agendamento para atualizar, retorna um erro
    if (!updatedAppointment) {
      return res.status(404).json({ message: 'Agendamento não encontrado nesta clínica.' });
    }

    res.status(200).json(updatedAppointment);

  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar agendamento', error: error.message });
  }
};


/**
 * @desc    Deletar (cancelar) um agendamento
 * @route   DELETE /api/appointments/:id
 * @access  Private
 */
exports.deleteAppointment = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.clinicId;

        // Tenta encontrar e deletar o agendamento
        // A condição de busca { _id: id, clinic: clinicId } é a nossa camada de segurança
        const deletedAppointment = await Appointment.findOneAndDelete({ _id: id, clinic: clinicId });

        if (!deletedAppointment) {
            return res.status(404).json({ message: 'Agendamento não encontrado para exclusão.' });
        }
        
        // Se a exclusão deu certo, retorna uma resposta 204 No Content,
        // que é o padrão para operações de delete bem-sucedidas.
        res.status(204).send();

    } catch (error) {
        res.status(500).json({ message: 'Erro ao deletar agendamento', error: error.message });
    }
};
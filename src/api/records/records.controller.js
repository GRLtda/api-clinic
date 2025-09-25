const MedicalRecordEntry = require('./records.model');
const Patient = require('../patients/patients.model'); // Precisamos verificar se o paciente pertence à clínica

/**
 * @desc    Criar nova entrada no prontuário de um paciente
 * @route   POST /api/patients/:patientId/records
 * @access  Private
 */
exports.createRecordEntry = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { content, appointment } = req.body; // Pega o conteúdo da nota
    const clinicId = req.clinicId;
    const authorId = req.user._id; // ID do médico logado

    // **CAMADA EXTRA DE SEGURANÇA**
    // Antes de criar a nota, verificamos se o paciente realmente pertence à clínica do médico.
    const patientExistsInClinic = await Patient.findOne({ _id: patientId, clinic: clinicId });
    if (!patientExistsInClinic) {
      return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });
    }

    if (!content) {
        return res.status(400).json({ message: 'O conteúdo da nota não pode ser vazio.' });
    }

    const newEntry = await MedicalRecordEntry.create({
      patient: patientId,
      clinic: clinicId,
      author: authorId,
      appointment: appointment, // Opcional: ID da consulta
      content: content,
    });

    res.status(201).json(newEntry);

  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar entrada no prontuário.', error: error.message });
  }
};


/**
 * @desc    Listar todas as entradas do prontuário de um paciente
 * @route   GET /api/patients/:patientId/records
 * @access  Private
 */
exports.getRecordEntriesForPatient = async (req, res) => {
  try {
    const { patientId } = req.params;
    const clinicId = req.clinicId;

    // Repetimos a verificação de segurança para garantir que o médico só veja prontuários autorizados
    const patientExistsInClinic = await Patient.findOne({ _id: patientId, clinic: clinicId });
    if (!patientExistsInClinic) {
      return res.status(404).json({ message: 'Paciente não encontrado nesta clínica.' });
    }

    const entries = await MedicalRecordEntry.find({ patient: patientId, clinic: clinicId })
      // Popula o campo 'author' com o nome do médico que escreveu a nota
      .populate('author', 'name') 
      // Ordena para que as notas mais recentes apareçam primeiro (formato de feed)
      .sort({ createdAt: -1 }); 

    res.status(200).json(entries);

  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar o prontuário do paciente.', error: error.message });
  }
};
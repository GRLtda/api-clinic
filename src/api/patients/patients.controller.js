const Patient = require('./patients.model');

// ===================================================================
// FUNÇÃO DE CRIAÇÃO DE PACIENTE (COM DEBUG)
// ===================================================================
exports.createPatient = async (req, res) => {
  try {
    // ---- INÍCIO DO DEBUG ----
    // Estas linhas são as "câmeras" que vão nos mostrar o que está acontecendo.
    console.log('\n\n--- INICIANDO DEBUG DA CRIAÇÃO DE PACIENTE ---');
    console.log('1. clinicId recebido do middleware:', req.clinicId);
    console.log('2. Tipo do clinicId:', typeof req.clinicId, '| Construtor:', req.clinicId ? req.clinicId.constructor.name : 'N/A');

    const patientData = { ...req.body, clinicId: req.clinicId };

    console.log('3. Objeto patientData COMPLETO (antes de criar):', patientData);
    console.log('4. Tipo do clinicId DENTRO do patientData:', typeof patientData.clinicId, '| Construtor:', patientData.clinicId ? patientData.clinicId.constructor.name : 'N/A');
    console.log('--- FIM DO DEBUG ---\n\n');
    // ---- FIM DO DEBUG ----

    const newPatient = new Patient(patientData);
    const savedPatient = await newPatient.save();
    res.status(201).json(savedPatient);
  } catch (error) {
    res.status(400).json({ message: 'Erro ao criar paciente', error: error.message });
  }
};
// ===================================================================


//
// --- O RESTO DO ARQUIVO CONTINUA IGUAL ---
//

exports.getAllPatients = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = { clinicId: req.clinicId };
    const totalPatients = await Patient.countDocuments(filter);
    const patients = await Patient.find(filter)
      .limit(limit)
      .skip(skip)
      .sort({ name: 1 });
    res.status(200).json({
      total: totalPatients,
      page: page,
      pages: Math.ceil(totalPatients / limit),
      limit: limit,
      data: patients,
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar pacientes', error: error.message });
  }
};

exports.getPatientById = async (req, res) => {
  try {
    const patient = await Patient.findOne({ _id: req.params.id, clinicId: req.clinicId });
    if (!patient) {
      return res.status(404).json({ message: 'Paciente não encontrado nesta clínica' });
    }
    res.status(200).json(patient);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar paciente', error: error.message });
  }
};

exports.updatePatient = async (req, res) => {
  try {
    const updatedPatient = await Patient.findOneAndUpdate(
      { _id: req.params.id, clinicId: req.clinicId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!updatedPatient) {
      return res.status(404).json({ message: 'Paciente não encontrado nesta clínica' });
    }
    res.status(200).json(updatedPatient);
  } catch (error) {
    res.status(400).json({ message: 'Erro ao atualizar paciente', error: error.message });
  }
};

exports.deletePatient = async (req, res) => {
  try {
    const deletedPatient = await Patient.findOneAndDelete({ _id: req.params.id, clinicId: req.clinicId });
    if (!deletedPatient) {
        return res.status(404).json({ message: 'Paciente não encontrado nesta clínica' });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao excluir paciente', error: error.message });
  }
};
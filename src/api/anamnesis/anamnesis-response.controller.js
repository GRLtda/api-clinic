const AnamnesisResponse = require('./anamnesis-response.model');
const Patient = require('../patients/patients.model');

// ... (as funções createAnamnesisForPatient e getAnamnesisForPatient continuam aqui)
exports.createAnamnesisForPatient = async (req, res) => { /* ... código existente ... */ };
exports.getAnamnesisForPatient = async (req, res) => { /* ... código existente ... */ };


// @desc    Médico submete as respostas de uma anamnese
exports.submitAnamnesisByDoctor = async (req, res) => {
  try {
    const { responseId, patientId } = req.params;
    const { answers } = req.body;

    const updatedResponse = await AnamnesisResponse.findOneAndUpdate(
      // Condição de segurança: garante que a resposta pertence à clínica e ao paciente corretos
      { _id: responseId, patient: patientId, clinic: req.clinicId },
      {
        answers: answers,
        status: 'Preenchido',
      },
      { new: true }
    );

    if (!updatedResponse) {
      return res.status(404).json({ message: 'Registro de Anamnese não encontrado.' });
    }

    res.status(200).json(updatedResponse);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao salvar respostas da anamnese.', error: error.message });
  }
};


// @desc    Paciente submete as respostas de uma anamnese via link
exports.submitAnamnesisByPatient = async (req, res) => {
  try {
    const { token } = req.params;
    const { answers } = req.body;

    // 1. Encontra a anamnese pelo token único
    const response = await AnamnesisResponse.findOne({ patientAccessToken: token });

    // 2. Validações de segurança
    if (!response) {
      return res.status(404).json({ message: 'Formulário não encontrado ou inválido.' });
    }
    if (response.status === 'Preenchido') {
      return res.status(409).json({ message: 'Este formulário já foi respondido.' }); // 409 Conflict
    }
    if (response.patientAccessTokenExpires < new Date()) {
      return res.status(403).json({ message: 'O link para este formulário expirou.' }); // 403 Forbidden
    }

    // 3. Atualiza o documento
    response.answers = answers;
    response.status = 'Preenchido';
    // Invalida o token para que não possa ser usado novamente
    response.patientAccessToken = undefined;
    response.patientAccessTokenExpires = undefined;

    await response.save();

    res.status(200).json({ message: 'Obrigado por responder!' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao salvar respostas da anamnese.', error: error.message });
  }
};
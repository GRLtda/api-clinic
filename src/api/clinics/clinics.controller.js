const Clinic = require('./clinics.model');

// @desc    Criar a clínica para o usuário logado
// @route   POST /api/clinics
// @access  Private
exports.createClinic = async (req, res) => {
  try {
    // Pega o ID do usuário do token (que o middleware 'isAuthenticated' vai nos dar)
    const userId = req.user._id;

    // Verifica se este usuário já não tem uma clínica
    const existingClinic = await Clinic.findOne({ owner: userId });
    if (existingClinic) {
      return res.status(400).json({ message: 'Este usuário já possui uma clínica configurada.' });
    }

    // Cria a nova clínica associando o 'owner'
    const clinicData = { ...req.body, owner: userId };
    const newClinic = await Clinic.create(clinicData);

    res.status(201).json(newClinic);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao criar a clínica.', error: error.message });
  }
};
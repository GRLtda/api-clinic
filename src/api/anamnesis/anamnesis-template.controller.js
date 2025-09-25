const AnamnesisTemplate = require('./anamnesis-template.model');

// @desc    Criar um novo modelo de anamnese
exports.createTemplate = async (req, res) => {
  try {
    const { name, questions } = req.body;
    const clinicId = req.clinicId;

    if (!name || !questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'Nome e uma lista de perguntas são obrigatórios.' });
    }

    const newTemplate = await AnamnesisTemplate.create({
      name,
      questions,
      clinic: clinicId,
    });

    res.status(201).json(newTemplate);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Um modelo com este nome já existe nesta clínica.' });
    }
    res.status(500).json({ message: 'Erro ao criar modelo de anamnese.', error: error.message });
  }
};


// ====================================================================================
// @desc    Listar todos os modelos (APENAS NOME E ID)
// ====================================================================================
exports.getAllTemplates = async (req, res) => {
  try {
    const templates = await AnamnesisTemplate.find({ clinic: req.clinicId })
      // AQUI ESTÁ A MUDANÇA: Selecionamos apenas o campo 'name'.
      // O Mongoose sempre inclui o '_id' por padrão.
      .select('name')
      .sort({ name: 1 });
      
    res.status(200).json(templates);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar os modelos.', error: error.message });
  }
};
// ====================================================================================


// @desc    Buscar um modelo específico por ID (COMPLETO, COM AS PERGUNTAS)
exports.getTemplateById = async (req, res) => {
  try {
    // Esta função já faz o que você quer: busca um único documento com todos os detalhes.
    const template = await AnamnesisTemplate.findOne({ _id: req.params.id, clinic: req.clinicId });
    if (!template) {
      return res.status(404).json({ message: 'Modelo de anamnese não encontrado.' });
    }
    res.status(200).json(template);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar o modelo.', error: error.message });
  }
};

// @desc    Atualizar um modelo de anamnese
exports.updateTemplate = async (req, res) => {
  try {
    const updatedTemplate = await AnamnesisTemplate.findOneAndUpdate(
      { _id: req.params.id, clinic: req.clinicId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!updatedTemplate) {
      return res.status(404).json({ message: 'Modelo de anamnese não encontrado.' });
    }
    res.status(200).json(updatedTemplate);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar o modelo.', error: error.message });
  }
};

// @desc    Deletar um modelo de anamnese
exports.deleteTemplate = async (req, res) => {
  try {
    const deletedTemplate = await AnamnesisTemplate.findOneAndDelete({ _id: req.params.id, clinic: req.clinicId });
    if (!deletedTemplate) {
      return res.status(404).json({ message: 'Modelo de anamnese não encontrado.' });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar o modelo.', error: error.message });
  }
};
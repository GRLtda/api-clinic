require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline-sync');
const AnamnesisTemplate = require('../src/api/anamnesis/anamnesis-template.model');

// Conecta ao banco de dados
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Conectado com Sucesso!');
  } catch (err) {
    console.error('Erro ao conectar com o MongoDB:', err.message);
    process.exit(1);
  }
};

// Funções para gerar dados de exemplo
const generateSampleQuestions = (name) => {
  const commonQuestions = [
    { title: 'Motivo da consulta?', questionType: 'long_text' },
    { title: 'Você tem alergias?', questionType: 'yes_no_dontknow' },
    { title: 'Qual tipo de dor?', questionType: 'single_choice', options: ['Aguda', 'Crônica'] },
    { title: 'Qual a frequência?', questionType: 'single_choice', options: ['Diariamente', 'Semanalmente', 'Mensalmente'] },
  ];
  return commonQuestions;
};

// Função principal de automação
const runAutomation = async () => {
  await connectDB();

  try {
    const clinicId = readline.question('Insira o ID da clinica: ');
    if (!mongoose.isValidObjectId(clinicId)) {
      console.error('ID da clínica inválido. Saindo...');
      mongoose.disconnect();
      return;
    }

    const numberOfTemplates = parseInt(readline.question('Quantos modelos de anamnese deseja criar? '));
    if (isNaN(numberOfTemplates) || numberOfTemplates <= 0) {
      console.error('Número de modelos inválido. Saindo...');
      mongoose.disconnect();
      return;
    }

    console.log(`\nCriando ${numberOfTemplates} modelos de anamnese para a clinica ${clinicId}...\n`);

    const templatesToCreate = [];
    for (let i = 0; i < numberOfTemplates; i++) {
      const templateName = `Anamnese Automatizada #${i + 1}`;
      const questions = generateSampleQuestions(templateName);

      templatesToCreate.push({
        name: templateName,
        clinic: clinicId,
        questions,
      });
    }

    const result = await AnamnesisTemplate.insertMany(templatesToCreate, { ordered: false });
    console.log(`\n${result.length} modelos criados com sucesso!`);

  } catch (error) {
    if (error.code === 11000) {
      console.error('Erro: Um ou mais modelos já existem com os nomes gerados.');
    } else {
      console.error('Erro durante a automação:', error.message);
    }
  } finally {
    mongoose.disconnect();
  }
};

runAutomation();
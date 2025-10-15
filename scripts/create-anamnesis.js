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
const generateSampleQuestions = (name, numQuestions) => {
  const questionTypes = [
    { title: 'Motivo da consulta?', questionType: 'long_text' },
    { title: 'Você tem alergias?', questionType: 'long_text' },
    { title: 'Qual tipo de dor?', questionType: 'single_choice', options: ['Aguda', 'Crônica'] },
    { title: 'Qual a frequência?', questionType: 'single_choice', options: ['Diariamente', 'Semanalmente', 'Mensalmente'] },
    { title: 'Já fez cirurgia?', questionType: 'long_text' },
    { title: 'Está tomando medicamentos?', questionType: 'long_text' },
    { title: 'Tem histórico familiar?', questionType: 'long_text' }
  ];
  // Repete ou corta para o número desejado
  const questions = [];
  for (let i = 0; i < numQuestions; i++) {
    questions.push(questionTypes[i % questionTypes.length]);
  }
  return questions;
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

    const numberOfQuestions = parseInt(readline.question('Quantas questões por modelo? '));
    if (isNaN(numberOfQuestions) || numberOfQuestions <= 0) {
      console.error('Número de questões inválido. Saindo...');
      mongoose.disconnect();
      return;
    }

    console.log(`\nCriando ${numberOfTemplates} modelos de anamnese para a clinica ${clinicId} com ${numberOfQuestions} questões cada...\n`);

    const templatesToCreate = [];
    for (let i = 0; i < numberOfTemplates; i++) {
      const templateName = `Anamnese Automatizada #${i + 1}`;
      const questions = generateSampleQuestions(templateName, numberOfQuestions);

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
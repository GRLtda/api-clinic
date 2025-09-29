// scripts/create-patients.js
require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline-sync');
const { fakerPT_BR } = require('@faker-js/faker');
const Patient = require('../src/api/patients/patients.model');

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

// Função para gerar um paciente com dados fictícios
const generateSamplePatient = (clinicId) => {
  const name = fakerPT_BR.person.fullName();
  const gender = fakerPT_BR.helpers.arrayElement(['Masculino', 'Feminino', 'Outro']);
  // Gera uma data de nascimento para alguém entre 18 e 90 anos
  const birthDate = fakerPT_BR.date.past({ years: 90, refDate: new Date(Date.now() - 18 * 365 * 24 * 60 * 60 * 1000) });
  const phone = fakerPT_BR.phone.number('119########'); // Formato de celular de SP
  const cpf = fakerPT_BR.string.numeric(11); // Gera 11 dígitos numéricos
  const address = {
    cep: fakerPT_BR.location.zipCode(),
    street: fakerPT_BR.location.street(),
    number: fakerPT_BR.string.numeric(3),
    district: fakerPT_BR.location.secondaryAddress(), // Bairro
    city: fakerPT_BR.location.city(),
    state: fakerPT_BR.location.state({ abbreviated: true }),
  };

  return {
    name,
    gender,
    birthDate,
    phone,
    cpf,
    address,
    clinicId,
  };
};

// Função principal de automação
const runAutomation = async () => {
  await connectDB();

  try {
    const clinicId = readline.question('Insira o ID da clinica: ');
    if (!mongoose.Types.ObjectId.isValid(clinicId)) {
      console.error('ID da clínica inválido. Saindo...');
      return;
    }

    const numberOfPatients = parseInt(readline.question('Quantos pacientes deseja criar? '));
    if (isNaN(numberOfPatients) || numberOfPatients <= 0) {
      console.error('Número de pacientes inválido. Saindo...');
      return;
    }

    console.log(`\nCriando ${numberOfPatients} pacientes para a clinica ${clinicId}...\n`);

    const patientsToCreate = [];
    for (let i = 0; i < numberOfPatients; i++) {
      patientsToCreate.push(generateSamplePatient(clinicId));
    }

    // Usamos insertMany para uma inserção em massa, mais eficiente.
    const result = await Patient.insertMany(patientsToCreate, { ordered: false });
    console.log(`\n${result.length} pacientes criados com sucesso!`);

  } catch (error) {
    // O Mongoose retorna um erro com a propriedade `writeErrors` em inserções em massa
    if (error.code === 11000 || error.writeErrors) {
       const duplicateErrors = error.writeErrors?.filter(e => e.err.code === 11000).length || 1;
      console.error(`\nErro: ${duplicateErrors} CPF(s) já existem nesta clínica e foram ignorados.`);
      // Informa quantos foram criados com sucesso apesar dos erros de duplicidade
      const successfulInserts = error.result?.nInserted || 0;
      if (successfulInserts > 0) {
        console.log(`${successfulInserts} pacientes foram criados com sucesso.`);
      }
    } else {
      console.error('Erro durante a automação:', error.message);
    }
  } finally {
    await mongoose.disconnect();
    console.log('Conexão com o MongoDB encerrada.');
  }
};

runAutomation();
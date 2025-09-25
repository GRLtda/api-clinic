const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// --- Configuração ---
// Altere para a URL base da sua API
const BASE_URL = 'http://localhost:3001/api';

const api = axios.create({
    baseURL: BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Variáveis para armazenar dados entre as requisições
let authToken = '';
let createdPatientId = '';
let createdAppointmentId = '';
let createdTemplateId = '';
let anamnesisResponseId = '';
let uploadedImageId = '';

// --- Funções de Teste ---

const logResult = (message, data) => {
    console.log(`\n--- ${message} ---`);
    console.log(data);
    console.log('--------------------');
};

const logError = (message, error) => {
    console.error(`\n--- ERRO em ${message} ---`);
    if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', error.response.data);
    } else {
        console.error('Erro:', error.message);
    }
    console.error('--------------------------');
};

/**
 * Define o token de autorização para as futuras requisições
 * @param {string} token - O token JWT
 */
const setAuthToken = (token) => {
    authToken = token;
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};

// 1. Módulo de Autenticação
const testAuthModule = async () => {
    try {
        // 1.1 Registrar Novo Usuário
        const newUser = {
            name: 'Usuário Teste',
            email: `teste${Date.now()}@example.com`,
            phone: '11999999999',
            password: 'password123',
        };
        let registerResponse = await api.post('/auth/register', newUser);
        logResult('1.1 Registrar Novo Usuário (Público)', registerResponse.data);
        const token = registerResponse.data.token;
        setAuthToken(token);

        // 1.2 Fazer Login
        let loginResponse = await api.post('/auth/login', {
            email: newUser.email,
            password: 'password123',
        });
        logResult('1.2 Fazer Login (Público)', loginResponse.data);
        // Atualiza o token, caso seja diferente
        setAuthToken(loginResponse.data.token);

    } catch (error) {
        logError('Módulo de Autenticação', error);
        throw error; // Interrompe a execução se a autenticação falhar
    }
};

// 2. Módulo de Clínica
const testClinicsModule = async () => {
    try {
        // 2.1 Configurar Detalhes da Clínica
        const clinicDetails = {
            name: "Clínica Teste",
            responsibleName: "Dr. Teste",
            cnpj: "12345678000199",
            address: {
                cep: "12345-678",
                city: "São Paulo",
                state: "SP"
            }
        };
        const response = await api.post('/clinics', clinicDetails);
        logResult('2.1 Configurar Detalhes da Clínica (Privado)', response.data);
    } catch (error) {
        logError('Módulo de Clínica', error);
    }
};

// 3. Módulo de Pacientes
const testPatientsModule = async () => {
    try {
        // 3.1 Criar Paciente
        const newPatient = {
            name: 'Paciente Teste',
            gender: 'Masculino',
            birthDate: '1990-01-15',
            phone: '11888888888',
            cpf: '123.456.789-00',
        };
        let createResponse = await api.post('/patients', newPatient);
        logResult('3.1 Criar Paciente (Privado)', createResponse.data);
        createdPatientId = createResponse.data._id;

        // 3.2 Listar Pacientes
        let listResponse = await api.get('/patients?page=1&limit=5');
        logResult('3.2 Listar Pacientes (Privado)', listResponse.data);

        // 3.3 Obter Detalhes de um Paciente
        let getResponse = await api.get(`/patients/${createdPatientId}`);
        logResult('3.3 Obter Detalhes do Paciente (Privado)', getResponse.data);

        // 3.4 Atualizar Paciente
        let updateResponse = await api.put(`/patients/${createdPatientId}`, { phone: '11777777777' });
        logResult('3.4 Atualizar Paciente (Privado)', updateResponse.data);

    } catch (error) {
        logError('Módulo de Pacientes', error);
    }
};

// 4. Módulo de Agendamentos
const testAppointmentsModule = async () => {
    try {
        // 4.1 Criar Agendamento
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hora depois
        const newAppointment = {
            patient: createdPatientId,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            notes: 'Consulta de rotina.',
            sendReminder: false
        };
        let createResponse = await api.post('/appointments', newAppointment);
        logResult('4.1 Criar Agendamento (Privado)', createResponse.data);
        createdAppointmentId = createResponse.data._id;

        // 4.2 Listar Agendamentos por Período
        const startDate = new Date().toISOString().split('T')[0];
        const endDate = new Date(new Date().setDate(new Date().getDate() + 30)).toISOString().split('T')[0];
        let listResponse = await api.get(`/appointments?startDate=${startDate}&endDate=${endDate}`);
        logResult('4.2 Listar Agendamentos (Privado)', listResponse.data);

        // 4.3 Atualizar Agendamento
        let updateResponse = await api.put(`/appointments/${createdAppointmentId}`, { notes: 'Consulta de rotina atualizada.' });
        logResult('4.3 Atualizar Agendamento (Privado)', updateResponse.data);

    } catch (error) {
        logError('Módulo de Agendamentos', error);
    }
};

// 5. Módulo de Prontuário
const testRecordsModule = async () => {
    try {
        // 5.1 Criar Entrada no Prontuário
        const newRecord = {
            content: '<p>Paciente relatou melhora nos sintomas.</p>',
            attachments: [] // Adicionar IDs de uploads aqui se houver
        };
        let createResponse = await api.post(`/patients/${createdPatientId}/records`, newRecord);
        logResult('5.1 Criar Entrada no Prontuário (Privado)', createResponse.data);

        // 5.2 Listar Entradas do Prontuário
        let listResponse = await api.get(`/patients/${createdPatientId}/records`);
        logResult('5.2 Listar Entradas do Prontuário (Privado)', listResponse.data);
    } catch (error) {
        logError('Módulo de Prontuário', error);
    }
};

// 7. Módulo de Uploads (Executado antes para ter um ID de anexo)
const testUploadsModule = async () => {
    try {
        // 7.1 Upload de Imagem
        const formData = new FormData();
        const imagePath = path.join(__dirname, 'test-image.jpg');
        
        if (!fs.existsSync(imagePath)) {
            console.error(`\nERRO: Arquivo de imagem 'test-image.jpg' não encontrado.`);
            return;
        }

        formData.append('image', fs.createReadStream(imagePath));
        formData.append('patientId', createdPatientId);

        const response = await api.post('/uploads/image', formData, {
            headers: formData.getHeaders(),
        });
        logResult('7.1 Upload de Imagem (Privado)', response.data);
        uploadedImageId = response.data.uploadId;
    } catch (error) {
        logError('Módulo de Uploads', error);
    }
};

// 6. Módulo de Anamnese
const testAnamnesisModule = async () => {
    try {
        // 6.1 Gerenciamento de Modelos
        const newTemplate = {
            name: 'Anamnese Geral Adulto',
            questions: [{ title: 'Histórico de doenças?', type: 'text' }]
        };
        let createTemplateResponse = await api.post('/anamnesis-templates', newTemplate);
        logResult('6.1.1 Criar Modelo de Anamnese (Privado)', createTemplateResponse.data);
        createdTemplateId = createTemplateResponse.data._id;

        let listTemplatesResponse = await api.get('/anamnesis-templates');
        logResult('6.1.2 Listar Modelos (Privado)', listTemplatesResponse.data);

        let getTemplateResponse = await api.get(`/anamnesis-templates/${createdTemplateId}`);
        logResult('6.1.3 Obter Modelo Completo (Privado)', getTemplateResponse.data);

        let updateTemplateResponse = await api.put(`/anamnesis-templates/${createdTemplateId}`, { name: 'Anamnese Geral Adulto (Atualizado)' });
        logResult('6.1.4 Atualizar Modelo (Privado)', updateTemplateResponse.data);
        
        // 6.2 Atribuir e Responder Anamnese
        const assignmentPayload = {
            templateId: createdTemplateId,
            answeredBy: 'Médico'
        };
        let assignResponse = await api.post(`/patients/${createdPatientId}/anamnesis`, assignmentPayload);
        logResult('6.2.1 Atribuir Anamnese ao Paciente (Privado)', assignResponse.data);
        anamnesisResponseId = assignResponse.data._id; // Assumindo que a resposta contenha o ID

        const answersPayload = {
            answers: [{ questionTitle: 'Histórico de doenças?', answer: 'Nenhum' }]
        };
        let saveAnswersResponse = await api.put(`/patients/${createdPatientId}/anamnesis/${anamnesisResponseId}`, answersPayload);
        logResult('6.2.2 Salvar Respostas (Médico - Privado)', saveAnswersResponse.data);

        // Não é possível testar a rota pública automaticamente pois requer interação do usuário (acessar um link único).

    } catch (error) {
        logError('Módulo de Anamnese', error);
    }
};

// --- Testes de Limpeza (DELETE) ---
const runCleanupTests = async () => {
    try {
        // 4.4 Cancelar Agendamento
        if(createdAppointmentId) {
            await api.delete(`/appointments/${createdAppointmentId}`);
            logResult('4.4 Cancelar Agendamento (Privado)', { status: 'Success - 204 No Content' });
        }

        // 6.1 Deletar Modelo de Anamnese
        if(createdTemplateId) {
            await api.delete(`/anamnesis-templates/${createdTemplateId}`);
            logResult('6.1.5 Deletar Modelo (Privado)', { status: 'Success - 204 No Content' });
        }

        // 3.5 Deletar Paciente
        if(createdPatientId) {
            await api.delete(`/patients/${createdPatientId}`);
            logResult('3.5 Deletar Paciente (Privado)', { status: 'Success - 204 No Content' });
        }
    } catch (error) {
        logError('Módulos de Limpeza (DELETE)', error);
    }
};


// --- Função Principal de Execução ---
const runAllTests = async () => {
    try {
        await testAuthModule();
        await testClinicsModule();
        await testPatientsModule();
        // Apenas continua se um paciente foi criado
        if (createdPatientId) {
            await testUploadsModule(); // Testar upload para ter um anexo
            await testAppointmentsModule();
            await testRecordsModule();
            await testAnamnesisModule();
            await runCleanupTests(); // Executa os testes de DELETE no final
        } else {
            console.error('\nCriação do paciente falhou. Abortando testes dependentes.');
        }

        console.log('\n--- TODOS OS TESTES FORAM CONCLUÍDOS ---');
    } catch (error) {
        console.error('\n--- A EXECUÇÃO DOS TESTES FOI INTERROMPIDA DEVIDO A UM ERRO CRÍTICO ---');
    }
};

// Inicia a execução dos testes
runAllTests();
    const mongoose = require('mongoose');
    const { Schema } = mongoose;

    const patientSchema = new Schema(
    {
        name: {
        type: String,
        required: true,
        trim: true, // Remove espaços em branco do início e do fim
        },
        gender: {
        type: String,
        enum: ['Masculino', 'Feminino', 'Outro'], // Só permite esses valores
        },
        birthDate: {
        type: Date,
        required: true,
        },
        phone: {
        type: String,
        required: true,
        trim: true,
        },
        cpf: {
        type: String,
        trim: true,
        },
        address: {
        cep: String,
        street: String,
        number: String,
        district: String,
        city: String,
        state: String,
        },
        clinicId: {
        type: Schema.Types.ObjectId,
        ref: 'Clinic',
        required: true,
        }
        // Futuramente, adicionaremos os campos de marketing e a referência à clínica aqui.
        // clinicId: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true }
    },
    {
        // Adiciona os campos `createdAt` e `updatedAt` automaticamente
        timestamps: true,
    }
    );

    patientSchema.index({ phone: 1, clinicId: 1 }, { unique: true });
    patientSchema.index({ cpf: 1, clinicId: 1 }, { unique: true, sparse: true });

    const Patient = mongoose.model('Patient', patientSchema);

    module.exports = Patient;
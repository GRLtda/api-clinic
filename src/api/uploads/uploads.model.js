const mongoose = require('mongoose');
const { Schema } = mongoose;

const uploadSchema = new Schema({
  url: { type: String, required: true }, // URL segura do Cloudinary
  public_id: { type: String, required: true }, // ID único do Cloudinary, essencial para deletar
  fileType: { type: String, default: 'image' },
  patient: { type: Schema.Types.ObjectId, ref: 'Patient' }, // Linkado ao paciente
  clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true }, // Linkado à clínica
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // Quem subiu
}, { timestamps: true });

const Upload = mongoose.model('Upload', uploadSchema);
module.exports = Upload;
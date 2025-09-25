// api/uploads/uploads.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const uploadSchema = new Schema(
  {
    url: { type: String, required: true, trim: true },
    public_id: { type: String, required: true, unique: true, index: true },
    fileType: { type: String, default: 'image', enum: ['image', 'pdf', 'other'] },
    patient: { type: Schema.Types.ObjectId, ref: 'Patient' },
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

const Upload = mongoose.model('Upload', uploadSchema);
module.exports = Upload;

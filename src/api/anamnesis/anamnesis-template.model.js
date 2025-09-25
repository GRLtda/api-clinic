// api/anamnesis/anamnesis-template.model.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const questionSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    questionType: {
      type: String,
      required: true,
      enum: [
        'text',
        'long_text',
        'yes_no',
        'yes_no_dontknow',
        'single_choice',
        'multiple_choice',
      ],
    },
    options: [{ type: String, trim: true }],
  },
  { _id: false }
);

// valida opções quando necessário
questionSchema.pre('validate', function (next) {
  if (
    (this.questionType === 'single_choice' || this.questionType === 'multiple_choice') &&
    (!Array.isArray(this.options) || this.options.length === 0)
  ) {
    return next(new Error('Perguntas de escolha devem possuir pelo menos uma opção.'));
  }
  next();
});

const anamnesisTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    questions: [questionSchema],
  },
  { timestamps: true }
);

anamnesisTemplateSchema.index({ clinic: 1, name: 1 }, { unique: true });

anamnesisTemplateSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const AnamnesisTemplate = mongoose.model('AnamnesisTemplate', anamnesisTemplateSchema);
module.exports = AnamnesisTemplate;

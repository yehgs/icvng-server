import mongoose from 'mongoose';

const attributeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    values: [String],
  },
  { timestamps: true }
);
const AttributeModel = mongoose.model('attribute', attributeSchema);

export default AttributeModel;

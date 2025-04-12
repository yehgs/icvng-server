import AttributeModel from '../models/attribute.model.js';

export const addAttributeController = async (req, res) => {
  try {
    const { name, values } = req.body;

    if (!name || !Array.isArray(values)) {
      return res.status(400).json({
        message: 'Enter required fields',
        error: true,
        success: false,
      });
    }

    const newAttribute = new AttributeModel({ name, values });
    const savedAttribute = await newAttribute.save();

    return res.json({
      message: 'Attribute added successfully',
      data: savedAttribute,
      success: true,
      error: false,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};

export const getAttributesController = async (req, res) => {
  try {
    const attributes = await AttributeModel.find().sort({ createdAt: -1 });
    return res.json({ data: attributes, success: true, error: false });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};

export const updateAttributeController = async (req, res) => {
  try {
    const { _id, name, values } = req.body;

    const updated = await AttributeModel.updateOne({ _id }, { name, values });

    return res.json({
      message: 'Attribute updated successfully',
      success: true,
      error: false,
      data: updated,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};

export const deleteAttributeController = async (req, res) => {
  try {
    const { _id } = req.body;

    const deleted = await AttributeModel.deleteOne({ _id });

    return res.json({
      message: 'Attribute deleted successfully',
      data: deleted,
      error: false,
      success: true,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};

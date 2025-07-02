import { ColorModel } from '../models/color.model.js';
import generateSlug from '../utils/generateSlug.js';

export const createColorController = async (request, response) => {
  try {
    const { name, hexCode, slug } = request.body;

    if (!name || !hexCode) {
      return response.status(400).json({
        message: 'Name and hex code are required',
        error: true,
        success: false,
      });
    }

    const generatedSlug = slug || generateSlug(name);

    const existingColor = await ColorModel.findOne({
      $or: [{ slug: generatedSlug }, { hexCode }],
    });

    if (existingColor) {
      return response.status(400).json({
        message: 'Color with this name or hex code already exists',
        error: true,
        success: false,
      });
    }

    const color = new ColorModel({
      name,
      hexCode,
      slug: generatedSlug,
    });

    const savedColor = await color.save();

    return response.json({
      message: 'Color created successfully',
      data: savedColor,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getColorsController = async (request, response) => {
  try {
    const colors = await ColorModel.find().sort({ createdAt: -1 });

    return response.json({
      message: 'Colors retrieved successfully',
      data: colors,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const deleteColorController = async (request, response) => {
  try {
    const { colorId } = request.body;

    if (!colorId) {
      return response.status(400).json({
        message: 'Color ID is required',
        error: true,
        success: false,
      });
    }

    const deletedColor = await ColorModel.findByIdAndDelete(colorId);

    if (!deletedColor) {
      return response.status(404).json({
        message: 'Color not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Color deleted successfully',
      data: deletedColor,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const updateColorController = async (request, response) => {
  try {
    const { colorId, name, hexCode, slug } = request.body;

    if (!colorId) {
      return response.status(400).json({
        message: 'Color ID is required',
        error: true,
        success: false,
      });
    }

    const color = await ColorModel.findById(colorId);

    if (!color) {
      return response.status(404).json({
        message: 'Color not found',
        error: true,
        success: false,
      });
    }

    color.name = name || color.name;
    color.hexCode = hexCode || color.hexCode;
    color.slug = slug || color.slug;

    const updatedColor = await color.save();

    return response.json({
      message: 'Color updated successfully',
      data: updatedColor,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

import { translateEntity } from "../utils/translationService.js";
import SliderModel from "../models/slider.model.js";

export const addSliderController = async (request, response) => {
  try {
    const { title, description, imageUrl, url, isActive, order, countryCode } = request.body;

    if (!title || !imageUrl) {
      return response.status(400).json({
        message: "Title and image URL are required",
        error: true,
        success: false,
      });
    }

    const addSlider = new SliderModel({
      title,
      description: description || "",
      imageUrl,
      url: url || "",
      isActive: isActive !== undefined ? isActive : true,
      order: order || 0,
      // A COUNTRY-scoped admin is stamped with their own country regardless
      // of this value — only takes effect for GLOBAL/HQ admins explicitly
      // targeting a specific market.
      ...(countryCode && { countryCode: countryCode.toUpperCase() }),
    });

    const saveSlider = await addSlider.save();

    if (!saveSlider) {
      return response.status(500).json({
        message: "Slider not created!",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Slider successfully created",
      data: saveSlider,
      success: true,
      error: false,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const getSlidersController = async (request, response) => {
  try {
    // Get all sliders for admin
    const data = await SliderModel.find().sort({ order: 1, createdAt: -1 });

    return response.json({
      data: data,
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

export const getActiveSlidersController = async (request, response) => {
  try {
    // Get only active sliders for the frontend, scoped to the visited
    // domain's country — falling back to HQ (Nigeria) if that market hasn't
    // added its own slider yet.
    const targetCountry = request.country?.code || 'NG';

    let data = await SliderModel.find({ isActive: true, countryCode: targetCountry }).sort({ order: 1 });
    if (data.length === 0 && targetCountry !== 'NG') {
      data = await SliderModel.find({ isActive: true, countryCode: 'NG' }).sort({ order: 1 });
    }

    return response.json({
      data: data,
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

export const updateSliderController = async (request, response) => {
  try {
    const { _id, title, description, imageUrl, url, isActive, order } =
      request.body;

    if (!_id) {
      return response.status(400).json({
        message: "Slider ID is required",
        error: true,
        success: false,
      });
    }

    const updateData = {
      ...(title && { title }),
      ...(description !== undefined && { description }),
      ...(imageUrl && { imageUrl }),
      ...(url !== undefined && { url }),
      ...(isActive !== undefined && { isActive }),
      ...(order !== undefined && { order }),
    };

    const update = await SliderModel.findByIdAndUpdate(_id, updateData, {
      new: true,
    });

    if (!update) {
      return response.status(404).json({
        message: "Slider not found",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Slider updated successfully",
      success: true,
      error: false,
      data: update,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

export const deleteSliderController = async (request, response) => {
  try {
    const { _id } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: "Slider ID is required",
        error: true,
        success: false,
      });
    }

    const deleteSlider = await SliderModel.findByIdAndDelete(_id);

    if (!deleteSlider) {
      return response.status(404).json({
        message: "Slider not found",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Slider deleted successfully",
      data: deleteSlider,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      success: false,
      error: true,
    });
  }
};

import CoffeeRoastAreaModel from '../models/roasted-area.model.js';
import generateSlug from '../utils/generateSlug.js';

export const addCoffeeRoastAreaController = async (req, res) => {
  try {
    const { city, region, country, latitude, longitude } = req.body;

    if (!country) {
      return res.status(400).json({
        message: 'Country field is required',
        error: true,
        success: false,
      });
    }

    // Generate a base for the slug
    let slugBase = country;
    if (region) slugBase = `${region}-${slugBase}`;
    if (city) slugBase = `${city}-${slugBase}`;

    const slug = generateSlug(slugBase);

    // Check for existing area with same slug
    const existingArea = await CoffeeRoastAreaModel.findOne({ slug });
    if (existingArea) {
      return res.status(400).json({
        message: 'A coffee roast area with these details already exists',
        error: true,
        success: false,
      });
    }

    const newArea = new CoffeeRoastAreaModel({
      city,
      region,
      country,
      latitude,
      longitude,
      slug,
    });

    const savedArea = await newArea.save();

    return res.json({
      message: 'Coffee roast area added successfully',
      data: savedArea,
      success: true,
      error: false,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};

export const getCoffeeRoastAreasController = async (req, res) => {
  try {
    const areas = await CoffeeRoastAreaModel.find().sort({ createdAt: -1 });
    return res.json({ data: areas, success: true, error: false });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};

export const updateCoffeeRoastAreaController = async (req, res) => {
  try {
    const { _id, city, region, country, latitude, longitude } = req.body;

    if (!_id) {
      return res.status(400).json({
        message: 'Area ID is required',
        error: true,
        success: false,
      });
    }

    if (!country) {
      return res.status(400).json({
        message: 'Country field is required',
        error: true,
        success: false,
      });
    }

    const updateData = {
      country,
    };

    if (city !== undefined) updateData.city = city;
    if (region !== undefined) updateData.region = region;
    if (latitude !== undefined) updateData.latitude = latitude;
    if (longitude !== undefined) updateData.longitude = longitude;

    // Generate new slug
    let slugBase = country;
    if (region) slugBase = `${region}-${slugBase}`;
    if (city) slugBase = `${city}-${slugBase}`;

    updateData.slug = generateSlug(slugBase);

    // Check if new slug already exists for another area
    const duplicateSlug = await CoffeeRoastAreaModel.findOne({
      slug: updateData.slug,
      _id: { $ne: _id },
    });

    if (duplicateSlug) {
      return res.status(400).json({
        message: 'A coffee roast area with these details already exists',
        error: true,
        success: false,
      });
    }

    const update = await CoffeeRoastAreaModel.findByIdAndUpdate(
      _id,
      updateData,
      {
        new: true,
      }
    );

    if (!update) {
      return res.status(404).json({
        message: 'Coffee roast area not found',
        error: true,
        success: false,
      });
    }

    return res.json({
      message: 'Coffee roast area updated successfully',
      success: true,
      error: false,
      data: update,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};

export const deleteCoffeeRoastAreaController = async (req, res) => {
  try {
    const { _id } = req.body;

    if (!_id) {
      return res.status(400).json({
        message: 'Area ID is required',
        error: true,
        success: false,
      });
    }

    const deleted = await CoffeeRoastAreaModel.deleteOne({ _id });

    if (deleted.deletedCount === 0) {
      return res.status(404).json({
        message: 'Coffee roast area not found',
        error: true,
        success: false,
      });
    }

    return res.json({
      message: 'Coffee roast area deleted successfully',
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

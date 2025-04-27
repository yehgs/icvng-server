import SubCategoryModel from '../models/subCategory.model.js';
import generateSlug from '../utils/generateSlug.js';

export const AddSubCategoryController = async (request, response) => {
  try {
    const { name, image, slug, category } = request.body;

    if (!name && !image && !category[0]) {
      return response.status(400).json({
        message: 'Provide name, image, category',
        error: true,
        success: false,
      });
    }

    // Generate slug if not provided
    const generatedSlug = slug || generateSlug(name);

    // Check for existing slug to ensure uniqueness
    const existingSubCategory = await SubCategoryModel.findOne({
      slug: generatedSlug,
    });
    if (existingSubCategory) {
      return response.status(400).json({
        message: 'A subCategory with this slug already exists',
        error: true,
        success: false,
      });
    }

    const payload = {
      name,
      image,
      slug: generatedSlug,
      category,
    };

    const createSubCategory = new SubCategoryModel(payload);
    const save = await createSubCategory.save();

    return response.json({
      message: 'Sub Category Created',
      data: save,
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

export const getSubCategoryController = async (request, response) => {
  try {
    const data = await SubCategoryModel.find()
      .sort({ createdAt: -1 })
      .populate('category');
    return response.json({
      message: 'Sub Category data',
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

export const updateSubCategoryController = async (request, response) => {
  try {
    const { _id, name, image, category } = request.body;

    const updateData = {
      ...(name && { name }),
      ...(image && { image }),
      ...(category && { category }),
    };

    if (name) {
      updateData.slug = generateSlug(name);
    }

    if (updateData.slug) {
      const existingSubCategory = await SubCategoryModel.findOne({
        slug: updateData.slug,
        _id: { $ne: _id },
      });

      if (existingSubCategory) {
        return response.status(400).json({
          message: 'A subcategory with this slug already exists',
          error: true,
          success: false,
        });
      }
    }

    const checkSub = await SubCategoryModel.findById(_id);

    if (!checkSub) {
      return response.status(400).json({
        message: 'Invalid _id provided',
        error: true,
        success: false,
      });
    }

    const updateSubCategory = await SubCategoryModel.findByIdAndUpdate(
      _id,
      updateData,
      { new: true } // return updated document
    );

    return response.json({
      message: 'Updated Successfully',
      data: updateSubCategory,
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

export const deleteSubCategoryController = async (request, response) => {
  try {
    const { _id } = request.body;
    console.log('Id', _id);
    const deleteSub = await SubCategoryModel.findByIdAndDelete(_id);

    return response.json({
      message: 'Delete successfully',
      data: deleteSub,
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

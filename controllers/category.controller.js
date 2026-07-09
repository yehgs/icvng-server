import CategoryModel from "../models/category.model.js";
import SubCategoryModel from "../models/subCategory.model.js";
import ProductModel from "../models/product.model.js";
import generateSlug from "../utils/generateSlug.js";
import { translateEntity, getBulkTranslations, applyTranslation } from "../utils/translationService.js";

export const AddCategoryController = async (request, response) => {
  try {
    const { name, image, slug } = request.body;

    if (!name) {
      return response.status(400).json({
        message: "Category name is required",
        error: true,
        success: false,
      });
    }

    // Generate slug if not provided
    const generatedSlug = slug || generateSlug(name);

    // Check for existing slug to ensure uniqueness
    const existingCategory = await CategoryModel.findOne({
      slug: generatedSlug,
    });
    if (existingCategory) {
      return response.status(400).json({
        message: "A category with this slug already exists",
        error: true,
        success: false,
      });
    }

    const addCategory = new CategoryModel({
      name,
      image: image || "",
      slug: generatedSlug,
    });

    const saveCategory = await addCategory.save();

    if (!saveCategory) {
      return response.status(500).json({
        message: "Category could not be created",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Category Added Successfully",
      data: saveCategory,
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

export const getCategoryController = async (request, response) => {
  try {
    const data = await CategoryModel.find().sort({ createdAt: -1 });

    // Localize into the active language (same mechanism as the category
    // mega-menu / category-structure endpoint) — this plain list feeds the
    // homepage "Shop by Category" filter carousel, which was bypassing
    // localization entirely by calling this endpoint instead.
    const language =
      (request.headers["x-language"] || "").toLowerCase() ||
      request.country?.language?.default ||
      "en";

    let localizedData = data;
    if (language !== "en") {
      const ids = data.map((c) => c._id.toString());
      const fieldsByCategory = await getBulkTranslations("category", ids, language);
      localizedData = data.map((cat) => {
        const fields = fieldsByCategory.get(cat._id.toString());
        return fields ? applyTranslation(cat.toObject(), fields) : cat;
      });
    }

    return response.json({
      data: localizedData,
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

export const updateCategoryController = async (request, response) => {
  try {
    const { _id, name, image, slug } = request.body;

    // If name is provided, generate a new slug
    const updateData = {
      ...(name && { name }),
      ...(image && { image }),
      ...(name && { slug: generateSlug(name) }),
      ...(slug && { slug: generateSlug(slug) }),
    };

    // Check for existing slug to ensure uniqueness if a new slug is being set
    if (updateData.slug) {
      const existingCategory = await CategoryModel.findOne({
        slug: updateData.slug,
        _id: { $ne: _id },
      });

      if (existingCategory) {
        return response.status(400).json({
          message: "A category with this slug already exists",
          error: true,
          success: false,
        });
      }
    }

    const update = await CategoryModel.updateOne({ _id: _id }, updateData);

    return response.json({
      message: "Category Updated Successfully",
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

export const deleteCategoryController = async (request, response) => {
  try {
    const { _id } = request.body;

    const checkSubCategory = await SubCategoryModel.find({
      category: {
        $in: [_id],
      },
    }).countDocuments();

    const checkProduct = await ProductModel.find({
      category: {
        $in: [_id],
      },
    }).countDocuments();

    if (checkSubCategory > 0 || checkProduct > 0) {
      return response.status(400).json({
        message: "Category is already use can't delete",
        error: true,
        success: false,
      });
    }

    const deleteCategory = await CategoryModel.deleteOne({ _id: _id });

    return response.json({
      message: "Delete category successfully",
      data: deleteCategory,
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

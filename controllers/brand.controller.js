import BrandModel from "../models/brand.model.js";
import ProductModel from "../models/product.model.js";
import generateSlug from "../utils/generateSlug.js";
import { translateEntity, getBulkTranslations, applyTranslation } from "../utils/translationService.js";

export const AddBrandController = async (request, response) => {
  try {
    const { name, image, slug, compatibleSystem } = request.body;

    if (!name || !image) {
      return response.status(400).json({
        message: "Enter required fields",
        error: true,
        success: false,
      });
    }

    // Generate slug if not provided
    const generatedSlug = slug || generateSlug(name);

    const existingBrand = await BrandModel.findOne({
      slug: generatedSlug,
    });

    if (existingBrand) {
      return response.status(400).json({
        message: "A brand with this slug already exists",
        error: true,
        success: false,
      });
    }

    const addBrand = new BrandModel({
      name,
      image,
      slug: generatedSlug,
      compatibleSystem: compatibleSystem || false,
    });

    const saveBrand = await addBrand.save();

    if (!saveBrand) {
      return response.status(500).json({
        message: "Brand not created!",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Brand successfully created",
      data: saveBrand,
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

export const getBrandController = async (request, response) => {
  try {
    const data = await BrandModel.find().sort({ createdAt: -1 });

    // Localize into the active language — same gap as categories/
    // subcategories: this feeds the shop filter sidebar's brand list.
    const language =
      (request.headers["x-language"] || "").toLowerCase() ||
      request.country?.language?.default ||
      "en";

    let localizedData = data;
    if (language !== "en") {
      const ids = data.map((b) => b._id.toString());
      const fieldsById = await getBulkTranslations("brand", ids, language);
      localizedData = data.map((brand) => {
        const fields = fieldsById.get(brand._id.toString());
        return fields ? applyTranslation(brand.toObject(), fields) : brand;
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

export const updateBrandController = async (request, response) => {
  try {
    const { _id, name, image, slug, compatibleSystem } = request.body;

    const updateData = {
      ...(name && { name }),
      ...(image && { image }),
      ...(name && { slug: generateSlug(name) }),
      ...(slug && { slug: generateSlug(slug) }),
      ...(compatibleSystem !== undefined && { compatibleSystem }),
    };

    if (updateData.slug) {
      const existingBrand = await BrandModel.findOne({
        slug: updateData.slug,
        _id: { $ne: _id },
      });

      if (existingBrand) {
        return response.status(400).json({
          message: "A brand with this slug already exists",
          error: true,
          success: false,
        });
      }
    }

    const update = await BrandModel.updateOne({ _id: _id }, updateData);

    return response.json({
      message: "Updated Brand",
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

export const deleteBrandController = async (request, response) => {
  try {
    const { _id } = request.body;

    const checkProduct = await ProductModel.find({
      brand: {
        $in: [_id],
      },
    }).countDocuments();

    if (checkProduct > 0) {
      return response.status(400).json({
        message: "Brand is already use can't delete",
        error: true,
        success: false,
      });
    }

    const deleteBrand = await BrandModel.deleteOne({ _id: _id });

    return response.json({
      message: "Delete brand successfully",
      data: deleteBrand,
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

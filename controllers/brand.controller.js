import BrandModel from "../models/brand.model.js";
import ProductModel from "../models/product.model.js";
import generateSlug from "../utils/generateSlug.js";

export const AddBrandController = async (request, response) => {
  try {
    const { name, image, slug, compatibleSystem } = request.body;

    // GRAPHICS is image updates to EXISTING records only — no creating
    // new brands (needs a name/slug, which they can't set).
    if (request.user?.subRole === "GRAPHICS") {
      return response.status(403).json({
        message: "Graphics/Designer accounts cannot create brands — image updates to existing brands only.",
        error: true,
        success: false,
      });
    }

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

    // NOTE: no auto-translate call here on purpose — brand names are
    // proper nouns and should never be machine-translated. See the
    // comment in utils/translationService.js's TRANSLATABLE_FIELDS.

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
    // NOTE: brand names are proper nouns and are never translated (see
    // TRANSLATABLE_FIELDS in utils/translationService.js) — no
    // localization pass needed here, unlike categories/subcategories.
    const data = await BrandModel.find().sort({ createdAt: -1 });

    return response.json({
      data,
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

    // GRAPHICS holds catalog.manage for image-only updates — strip
    // everything except image (same pattern as product.controller.js's
    // updateProductDetails).
    if (request.user?.subRole === "GRAPHICS") {
      if (updateData.name) delete updateData.name;
      if (updateData.slug) delete updateData.slug;
      if (updateData.compatibleSystem !== undefined) delete updateData.compatibleSystem;
    }

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

    const updatedBrand = await BrandModel.findByIdAndUpdate(_id, updateData, {
      new: true,
    });

    // NOTE: no auto-translate call here on purpose — see the note in
    // AddBrandController above.

    return response.json({
      message: "Updated Brand",
      success: true,
      error: false,
      data: updatedBrand,
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

    if (request.user?.subRole === "GRAPHICS") {
      return response.status(403).json({
        message: "Graphics/Designer accounts cannot delete brands.",
        error: true,
        success: false,
      });
    }

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

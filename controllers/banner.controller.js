import BannerModel from '../models/banner.model.js';
import generateSlug from '../utils/generateSlug.js';

export const addBannerController = async (request, response) => {
  try {
    const { title, subtitle, image, link, linkText, position, isActive, slug, countryCode } =
      request.body;

    if (!image || !position) {
      return response.status(400).json({
        message: 'Image and position are required fields',
        error: true,
        success: false,
      });
    }

    // Generate slug from title or create a default one
    const slugBase = title || `banner-${position}-${Date.now()}`;
    const generatedSlug = slug || generateSlug(slugBase);

    const existingBanner = await BannerModel.findOne({
      slug: generatedSlug,
    });

    if (existingBanner) {
      return response.status(400).json({
        message: 'A banner with this slug already exists',
        error: true,
        success: false,
      });
    }

    const addBanner = new BannerModel({
      title: title || '',
      subtitle: subtitle || '',
      image,
      link: link || '',
      linkText: linkText || 'Learn More',
      position,
      isActive: isActive !== undefined ? isActive : true,
      slug: generatedSlug,
      // A COUNTRY-scoped admin is stamped with their own country regardless
      // of this value (see countryScopedPlugin's pre-save hook + the
      // countryScope query-injection hooks) — this only takes effect for
      // GLOBAL/HQ admins explicitly targeting a specific market.
      ...(countryCode && { countryCode: countryCode.toUpperCase() }),
    });

    const saveBanner = await addBanner.save();

    if (!saveBanner) {
      return response.status(500).json({
        message: 'Banner not created!',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Banner successfully created',
      data: saveBanner,
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

export const getBannerController = async (request, response) => {
  try {
    const { position } = request.query;

    let query = {};
    if (position) {
      query.position = position;
    }

    const data = await BannerModel.find(query).sort({ createdAt: -1 });

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

export const getActiveBannersController = async (request, response) => {
  try {
    const { position } = request.query;
    const targetCountry = request.country?.code || 'NG';

    let query = { isActive: true };
    if (position) {
      query.position = position;
    }

    // Country-specific banners first; if this market hasn't set any up yet,
    // fall back to HQ's (Nigeria's) so the homepage is never empty.
    let data = await BannerModel.find({ ...query, countryCode: targetCountry }).sort({ createdAt: -1 });
    if (data.length === 0 && targetCountry !== 'NG') {
      data = await BannerModel.find({ ...query, countryCode: 'NG' }).sort({ createdAt: -1 });
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

export const updateBannerController = async (request, response) => {
  try {
    const {
      _id,
      title,
      subtitle,
      image,
      link,
      linkText,
      position,
      isActive,
      slug,
    } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: 'Banner ID is required',
        error: true,
        success: false,
      });
    }

    const updateData = {
      ...(title !== undefined && { title }),
      ...(subtitle !== undefined && { subtitle }),
      ...(image && { image }),
      ...(link !== undefined && { link }),
      ...(linkText && { linkText }),
      ...(position && { position }),
      ...(isActive !== undefined && { isActive }),
    };

    // Generate new slug if title is being updated
    if (title !== undefined || slug) {
      const slugBase = title || `banner-${position || 'default'}-${Date.now()}`;
      const newSlug = slug || generateSlug(slugBase);

      const existingBanner = await BannerModel.findOne({
        slug: newSlug,
        _id: { $ne: _id },
      });

      if (existingBanner) {
        return response.status(400).json({
          message: 'A banner with this slug already exists',
          error: true,
          success: false,
        });
      }

      updateData.slug = newSlug;
    }

    const update = await BannerModel.updateOne({ _id: _id }, updateData);

    if (update.matchedCount === 0) {
      return response.status(404).json({
        message: 'Banner not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Banner updated successfully',
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

export const deleteBannerController = async (request, response) => {
  try {
    const { _id } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: 'Banner ID is required',
        error: true,
        success: false,
      });
    }

    const deleteBanner = await BannerModel.deleteOne({ _id: _id });

    if (deleteBanner.deletedCount === 0) {
      return response.status(404).json({
        message: 'Banner not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Banner deleted successfully',
      data: deleteBanner,
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

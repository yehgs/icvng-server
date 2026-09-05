import PopupModel from "../models/popup.model.js";
import generateSlug from "../utils/generateSlug.js";
import { translateEntity } from "../utils/translationService.js";

// ── Admin: create ────────────────────────────────────────────────────────────
export const createPopupController = async (request, response) => {
  try {
    const {
      title,
      bodyText,
      image,
      ctaText,
      ctaLink,
      displayPages,
      displaySeconds,
      delaySeconds,
      showOncePerSession,
      startDate,
      endDate,
      isActive,
      priority,
      slug,
      countryCode,
    } = request.body;

    if (!title || !title.trim()) {
      return response.status(400).json({
        message: "Title is required",
        error: true,
        success: false,
      });
    }

    const slugBase = slug || `popup-${title}-${Date.now()}`;
    const generatedSlug = generateSlug(slugBase);

    const existing = await PopupModel.findOne({ slug: generatedSlug });
    if (existing) {
      return response.status(400).json({
        message: "A popup with this slug already exists",
        error: true,
        success: false,
      });
    }

    const popup = new PopupModel({
      title: title.trim(),
      bodyText: bodyText || "",
      image: image || "",
      ctaText: ctaText || "",
      ctaLink: ctaLink || "",
      displayPages:
        Array.isArray(displayPages) && displayPages.length ? displayPages : ["all"],
      displaySeconds: Number(displaySeconds) || 0,
      delaySeconds: Number(delaySeconds) || 0,
      showOncePerSession: showOncePerSession !== undefined ? !!showOncePerSession : true,
      startDate: startDate || null,
      endDate: endDate || null,
      isActive: isActive !== undefined ? !!isActive : true,
      priority: Number(priority) || 0,
      slug: generatedSlug,
      ...(countryCode && { countryCode: countryCode.toUpperCase() }),
    });

    const saved = await popup.save();

    // Auto-translate title/bodyText/ctaText to every non-English language,
    // same as banners/sliders — never let a "create" leave the pipeline
    // untriggered for content that's about to go live on the storefront.
    try {
      await translateEntity({
        entityType: "popup",
        entityId: saved._id,
        document: saved.toObject(),
      });
    } catch (err) {
      console.error("[translate] popup create:", err.message);
    }

    return response.json({
      message: "Popup created successfully",
      data: saved,
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

// ── Admin: list ──────────────────────────────────────────────────────────────
export const getPopupsAdminController = async (request, response) => {
  try {
    const data = await PopupModel.find({}).sort({ createdAt: -1 });
    return response.json({ data, success: true, error: false });
  } catch (error) {
    return response.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

// ── Admin: update ────────────────────────────────────────────────────────────
export const updatePopupController = async (request, response) => {
  try {
    const {
      _id,
      title,
      bodyText,
      image,
      ctaText,
      ctaLink,
      displayPages,
      displaySeconds,
      delaySeconds,
      showOncePerSession,
      startDate,
      endDate,
      isActive,
      priority,
      slug,
    } = request.body;

    if (!_id) {
      return response.status(400).json({
        message: "Popup ID is required",
        error: true,
        success: false,
      });
    }

    const updateData = {
      ...(title !== undefined && { title: title.trim() }),
      ...(bodyText !== undefined && { bodyText }),
      ...(image !== undefined && { image }),
      ...(ctaText !== undefined && { ctaText }),
      ...(ctaLink !== undefined && { ctaLink }),
      ...(Array.isArray(displayPages) &&
        displayPages.length && { displayPages }),
      ...(displaySeconds !== undefined && {
        displaySeconds: Number(displaySeconds) || 0,
      }),
      ...(delaySeconds !== undefined && {
        delaySeconds: Number(delaySeconds) || 0,
      }),
      ...(showOncePerSession !== undefined && {
        showOncePerSession: !!showOncePerSession,
      }),
      ...(startDate !== undefined && { startDate: startDate || null }),
      ...(endDate !== undefined && { endDate: endDate || null }),
      ...(isActive !== undefined && { isActive: !!isActive }),
      ...(priority !== undefined && { priority: Number(priority) || 0 }),
    };

    if (title !== undefined || slug) {
      const slugBase = slug || `popup-${title || "default"}-${Date.now()}`;
      const newSlug = slug || generateSlug(slugBase);
      const existing = await PopupModel.findOne({ slug: newSlug, _id: { $ne: _id } });
      if (existing) {
        return response.status(400).json({
          message: "A popup with this slug already exists",
          error: true,
          success: false,
        });
      }
      updateData.slug = newSlug;
    }

    const updated = await PopupModel.findByIdAndUpdate(_id, updateData, { new: true });

    if (!updated) {
      return response.status(404).json({
        message: "Popup not found",
        error: true,
        success: false,
      });
    }

    try {
      await translateEntity({
        entityType: "popup",
        entityId: updated._id,
        document: updated.toObject(),
      });
    } catch (err) {
      console.error("[translate] popup update:", err.message);
    }

    return response.json({
      message: "Popup updated successfully",
      data: updated,
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

// ── Admin: delete ────────────────────────────────────────────────────────────
export const deletePopupController = async (request, response) => {
  try {
    const { _id } = request.body;
    if (!_id) {
      return response.status(400).json({
        message: "Popup ID is required",
        error: true,
        success: false,
      });
    }

    const deleted = await PopupModel.deleteOne({ _id });
    if (deleted.deletedCount === 0) {
      return response.status(404).json({
        message: "Popup not found",
        error: true,
        success: false,
      });
    }

    return response.json({
      message: "Popup deleted successfully",
      data: deleted,
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

// ── Public: storefront ───────────────────────────────────────────────────────
// Returns the single highest-priority popup (if any) that is active, within
// its scheduling window, targets the requested page, and matches the
// visitor's market (with HQ/Nigeria fallback, same convention as banners).
export const getActivePopupController = async (request, response) => {
  try {
    const { page = "all" } = request.query;
    const targetCountry = request.country?.code || "NG";
    const now = new Date();

    const baseQuery = {
      isActive: true,
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
        { $or: [{ displayPages: "all" }, { displayPages: page }] },
      ],
    };

    let data = await PopupModel.find({ ...baseQuery, countryCode: targetCountry })
      .sort({ priority: -1, createdAt: -1 })
      .limit(1);

    if (data.length === 0 && targetCountry !== "NG") {
      data = await PopupModel.find({ ...baseQuery, countryCode: "NG" })
        .sort({ priority: -1, createdAt: -1 })
        .limit(1);
    }

    return response.json({
      data: data[0] || null,
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

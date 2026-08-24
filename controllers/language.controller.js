// controllers/language.controller.js
import LanguageModel from "../models/language.model.js";

const CODE_PATTERN = /^[a-z]{2}(-[a-z]{2})?$/;

// Public — client + admin language switchers. Active languages only.
export const getActiveLanguagesController = async (request, response) => {
  try {
    const languages = await LanguageModel.find({ isActive: true }).sort({
      sortOrder: 1,
      name: 1,
    });
    return response.json({ data: languages, error: false, success: true });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to load languages",
      error: true,
      success: false,
    });
  }
};

// Admin — full list (including inactive) for the management page.
export const getAllLanguagesController = async (request, response) => {
  try {
    const languages = await LanguageModel.find().sort({
      sortOrder: 1,
      name: 1,
    });
    return response.json({ data: languages, error: false, success: true });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to load languages",
      error: true,
      success: false,
    });
  }
};

export const createLanguageController = async (request, response) => {
  try {
    const { code, name, nativeName, flagEmoji, isRTL, isActive, sortOrder } =
      request.body;

    if (!code || !name || !nativeName) {
      return response.status(400).json({
        message: "code, name, and nativeName are required",
        error: true,
        success: false,
      });
    }

    const normalizedCode = String(code).trim().toLowerCase();
    if (!CODE_PATTERN.test(normalizedCode)) {
      return response.status(400).json({
        message:
          "code must be a valid ISO 639-1 language code, e.g. 'fr' (or a locale like 'pt-br')",
        error: true,
        success: false,
      });
    }

    const existing = await LanguageModel.findOne({ code: normalizedCode });
    if (existing) {
      return response.status(400).json({
        message: `Language '${normalizedCode}' already exists`,
        error: true,
        success: false,
      });
    }

    const language = await LanguageModel.create({
      code: normalizedCode,
      name: name.trim(),
      nativeName: nativeName.trim(),
      flagEmoji: flagEmoji || "",
      isRTL: !!isRTL,
      isActive: isActive !== undefined ? !!isActive : true,
      sortOrder: Number(sortOrder) || 0,
    });

    return response.json({
      message: "Language created",
      data: language,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to create language",
      error: true,
      success: false,
    });
  }
};

export const updateLanguageController = async (request, response) => {
  try {
    const { languageId } = request.params;
    const { name, nativeName, flagEmoji, isRTL, isActive, sortOrder } =
      request.body;

    const language = await LanguageModel.findById(languageId);
    if (!language) {
      return response.status(404).json({
        message: "Language not found",
        error: true,
        success: false,
      });
    }

    // "en" is the master/source content language every translatable field
    // is authored in by default (see translationService.js's
    // `sourceLanguage` default) — deactivating it would leave the
    // translation pipeline with nothing to translate FROM by default.
    if (language.code === "en" && isActive === false) {
      return response.status(400).json({
        message: "English is the master content language and can't be deactivated",
        error: true,
        success: false,
      });
    }

    if (name !== undefined) language.name = String(name).trim();
    if (nativeName !== undefined) language.nativeName = String(nativeName).trim();
    if (flagEmoji !== undefined) language.flagEmoji = flagEmoji;
    if (isRTL !== undefined) language.isRTL = !!isRTL;
    if (isActive !== undefined) language.isActive = !!isActive;
    if (sortOrder !== undefined) language.sortOrder = Number(sortOrder) || 0;

    await language.save();

    return response.json({
      message: "Language updated",
      data: language,
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to update language",
      error: true,
      success: false,
    });
  }
};

export const deleteLanguageController = async (request, response) => {
  try {
    const { languageId } = request.params;
    const language = await LanguageModel.findById(languageId);
    if (!language) {
      return response.status(404).json({
        message: "Language not found",
        error: true,
        success: false,
      });
    }
    if (language.code === "en") {
      return response.status(400).json({
        message: "English is the master content language and can't be deleted",
        error: true,
        success: false,
      });
    }

    await LanguageModel.findByIdAndDelete(languageId);

    // NOTE: existing Translation documents for this language are NOT
    // deleted here — they're simply orphaned (harmless, and recovered for
    // free if the language is re-added later). Deactivating (isActive:
    // false) rather than deleting is the safer default for a language
    // that already has translated content — delete is really for a
    // language added by mistake.
    return response.json({
      message: "Language deleted",
      error: false,
      success: true,
    });
  } catch (error) {
    return response.status(500).json({
      message: error.message || "Failed to delete language",
      error: true,
      success: false,
    });
  }
};

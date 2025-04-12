import TagModel from '../models/tag.model.js';
import generateSlug from '../utils/generateSlug.js';

export const addTagController = async (req, res) => {
  try {
    const { name, slug } = req.body;

    if (!name) {
      return res.status(400).json({
        message: 'Enter required fields',
        error: true,
        success: false,
      });
    }

    const generatedSlug = slug || generateSlug(name);

    const existingTag = await TagModel.findOne({
      slug: generatedSlug,
    });

    if (existingTag) {
      return res.status(400).json({
        message: 'A tag with this slug already exists',
        error: true,
        success: false,
      });
    }

    const newTag = new TagModel({ name, slug: generatedSlug });
    const savedTag = await newTag.save();

    return res.json({
      message: 'Tag added successfully',
      data: savedTag,
      success: true,
      error: false,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};

export const getTagsController = async (req, res) => {
  try {
    const tags = await TagModel.find().sort({ createdAt: -1 });
    return res.json({ data: tags, success: true, error: false });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message, error: true, success: false });
  }
};

export const updateTagController = async (req, res) => {
  try {
    const { _id, name, slug } = req.body;

    const updateData = {
      ...(name && { name }),
      ...(name && { slug: generateSlug(name) }),
      ...(slug && { slug: generateSlug(slug) }),
    };

    if (updateData.slug) {
      const existingTag = await TagModel.findOne({
        slug: updateData.slug,
        _id: { $ne: _id },
      });

      if (existingTag) {
        return res.status(400).json({
          message: 'A Tag with this slug already exists',
          error: true,
          success: false,
        });
      }
    }
    const update = await TagModel.updateOne({ _id: _id }, updateData);

    return res.json({
      message: 'Tag updated successfully',
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

export const deleteTagController = async (req, res) => {
  try {
    const { _id } = req.body;

    const deleted = await TagModel.deleteOne({ _id });

    return res.json({
      message: 'Tag deleted successfully',
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

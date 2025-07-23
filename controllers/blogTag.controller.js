// controllers/blogTag.controller.js
import BlogTagModel from '../models/blog-tag.model.js';
import BlogPostModel from '../models/blog-post.model.js';

// Create tag
export async function createBlogTagController(request, response) {
  try {
    const { name, description, color } = request.body;

    if (!name) {
      return response.status(400).json({
        message: 'Tag name is required',
        error: true,
        success: false,
      });
    }

    // Check if tag already exists
    const existingTag = await BlogTagModel.findOne({ name });
    if (existingTag) {
      return response.status(400).json({
        message: 'Tag already exists',
        error: true,
        success: false,
      });
    }

    const newTag = new BlogTagModel({
      name: name.trim(),
      description: description?.trim(),
      color: color || '#3B82F6',
    });

    const savedTag = await newTag.save();

    return response.status(201).json({
      message: 'Blog tag created successfully',
      data: savedTag,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Create blog tag error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to create blog tag',
      error: true,
      success: false,
    });
  }
}

// Get all tags
export async function getBlogTagsController(request, response) {
  try {
    const { page = 1, limit = 20, search, status } = request.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const tags = await BlogTagModel.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await BlogTagModel.countDocuments(query);

    return response.json({
      message: 'Blog tags retrieved successfully',
      data: tags,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get blog tags error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog tags',
      error: true,
      success: false,
    });
  }
}

// Get tag by ID
export async function getBlogTagController(request, response) {
  try {
    const { id } = request.params;

    const tag = await BlogTagModel.findById(id);

    if (!tag) {
      return response.status(404).json({
        message: 'Blog tag not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Blog tag retrieved successfully',
      data: tag,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get blog tag error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog tag',
      error: true,
      success: false,
    });
  }
}

// Update tag
export async function updateBlogTagController(request, response) {
  try {
    const { id } = request.params;
    const { name, description, color, status } = request.body;

    const tag = await BlogTagModel.findById(id);

    if (!tag) {
      return response.status(404).json({
        message: 'Blog tag not found',
        error: true,
        success: false,
      });
    }

    // Check if name is being changed and doesn't conflict
    if (name && name !== tag.name) {
      const existingTag = await BlogTagModel.findOne({
        name,
        _id: { $ne: id },
      });

      if (existingTag) {
        return response.status(400).json({
          message: 'Tag name already exists',
          error: true,
          success: false,
        });
      }
    }

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim();
    if (color) updateData.color = color;
    if (status) updateData.status = status;

    const updatedTag = await BlogTagModel.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    return response.json({
      message: 'Blog tag updated successfully',
      data: updatedTag,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update blog tag error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update blog tag',
      error: true,
      success: false,
    });
  }
}

// Delete tag
export async function deleteBlogTagController(request, response) {
  try {
    const { id } = request.params;

    const tag = await BlogTagModel.findById(id);

    if (!tag) {
      return response.status(404).json({
        message: 'Blog tag not found',
        error: true,
        success: false,
      });
    }

    // Check if tag is used in posts
    const postCount = await BlogPostModel.countDocuments({ tags: id });

    if (postCount > 0) {
      return response.status(400).json({
        message: `Cannot delete tag. It's used in ${postCount} blog post(s). Please remove the tag from posts first.`,
        error: true,
        success: false,
      });
    }

    await BlogTagModel.findByIdAndDelete(id);

    return response.json({
      message: 'Blog tag deleted successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Delete blog tag error:', error);
    return response.status(500).json({
      message: 'Failed to delete blog tag',
      error: true,
      success: false,
    });
  }
}

// Get public tags (for frontend)
export async function getPublicBlogTagsController(request, response) {
  try {
    const tags = await BlogTagModel.find({ status: 'ACTIVE' })
      .select('name slug description color postCount')
      .sort({ postCount: -1, name: 1 });

    return response.json({
      message: 'Blog tags retrieved successfully',
      data: tags,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get public blog tags error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog tags',
      error: true,
      success: false,
    });
  }
}

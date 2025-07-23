// controllers/blogCategory.controller.js
import BlogCategoryModel from '../models/blog-category.model.js';
import BlogPostModel from '../models/blog-post.model.js';

// Create category
export async function createBlogCategoryController(request, response) {
  try {
    const { name, description, image, seoTitle, seoDescription, seoKeywords } =
      request.body;

    if (!name) {
      return response.status(400).json({
        message: 'Category name is required',
        error: true,
        success: false,
      });
    }

    // Check if category already exists
    const existingCategory = await BlogCategoryModel.findOne({ name });
    if (existingCategory) {
      return response.status(400).json({
        message: 'Category already exists',
        error: true,
        success: false,
      });
    }

    const newCategory = new BlogCategoryModel({
      name: name.trim(),
      description: description?.trim(),
      image: image || '',
      seoTitle: seoTitle?.trim() || name.trim(),
      seoDescription: seoDescription?.trim(),
      seoKeywords: seoKeywords?.trim(),
    });

    const savedCategory = await newCategory.save();

    return response.status(201).json({
      message: 'Blog category created successfully',
      data: savedCategory,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Create blog category error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to create blog category',
      error: true,
      success: false,
    });
  }
}

// Get all categories
export async function getBlogCategoriesController(request, response) {
  try {
    const { page = 1, limit = 10, search, status } = request.query;

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

    const categories = await BlogCategoryModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await BlogCategoryModel.countDocuments(query);

    return response.json({
      message: 'Blog categories retrieved successfully',
      data: categories,
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
    console.error('Get blog categories error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog categories',
      error: true,
      success: false,
    });
  }
}

// Get category by ID
export async function getBlogCategoryController(request, response) {
  try {
    const { id } = request.params;

    const category = await BlogCategoryModel.findById(id);

    if (!category) {
      return response.status(404).json({
        message: 'Blog category not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Blog category retrieved successfully',
      data: category,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get blog category error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog category',
      error: true,
      success: false,
    });
  }
}

// Update category
export async function updateBlogCategoryController(request, response) {
  try {
    const { id } = request.params;
    const {
      name,
      description,
      image,
      status,
      seoTitle,
      seoDescription,
      seoKeywords,
    } = request.body;

    const category = await BlogCategoryModel.findById(id);

    if (!category) {
      return response.status(404).json({
        message: 'Blog category not found',
        error: true,
        success: false,
      });
    }

    // Check if name is being changed and doesn't conflict
    if (name && name !== category.name) {
      const existingCategory = await BlogCategoryModel.findOne({
        name,
        _id: { $ne: id },
      });

      if (existingCategory) {
        return response.status(400).json({
          message: 'Category name already exists',
          error: true,
          success: false,
        });
      }
    }

    const updateData = {};
    if (name) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim();
    if (image !== undefined) updateData.image = image;
    if (status) updateData.status = status;
    if (seoTitle !== undefined) updateData.seoTitle = seoTitle?.trim();
    if (seoDescription !== undefined)
      updateData.seoDescription = seoDescription?.trim();
    if (seoKeywords !== undefined) updateData.seoKeywords = seoKeywords?.trim();

    const updatedCategory = await BlogCategoryModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    return response.json({
      message: 'Blog category updated successfully',
      data: updatedCategory,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update blog category error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update blog category',
      error: true,
      success: false,
    });
  }
}

// Delete category
export async function deleteBlogCategoryController(request, response) {
  try {
    const { id } = request.params;

    const category = await BlogCategoryModel.findById(id);

    if (!category) {
      return response.status(404).json({
        message: 'Blog category not found',
        error: true,
        success: false,
      });
    }

    // Check if category has posts
    const postCount = await BlogPostModel.countDocuments({ category: id });

    if (postCount > 0) {
      return response.status(400).json({
        message: `Cannot delete category. It has ${postCount} blog post(s). Please move or delete the posts first.`,
        error: true,
        success: false,
      });
    }

    await BlogCategoryModel.findByIdAndDelete(id);

    return response.json({
      message: 'Blog category deleted successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Delete blog category error:', error);
    return response.status(500).json({
      message: 'Failed to delete blog category',
      error: true,
      success: false,
    });
  }
}

// Get public categories (for frontend)
export async function getPublicBlogCategoriesController(request, response) {
  try {
    const categories = await BlogCategoryModel.find({ status: 'ACTIVE' })
      .select('name slug description image postCount')
      .sort({ name: 1 });

    return response.json({
      message: 'Blog categories retrieved successfully',
      data: categories,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get public blog categories error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog categories',
      error: true,
      success: false,
    });
  }
}

// controllers/blogPost.controller.js
import BlogPostModel from '../models/blog-post.model.js';
import BlogCategoryModel from '../models/blog-category.model.js';
import BlogTagModel from '../models/blog-tag.model.js';

// Create blog post
export async function createBlogPostController(request, response) {
  try {
    const {
      title,
      excerpt,
      content,
      featuredImage,
      imageAlt,
      category,
      tags,
      status,
      seoTitle,
      seoDescription,
      seoKeywords,
      canonicalUrl,
      socialTitle,
      socialDescription,
      socialImage,
      relatedProducts,
    } = request.body;

    // Validation
    if (!title || !excerpt || !content || !featuredImage || !category) {
      return response.status(400).json({
        message:
          'Title, excerpt, content, featured image, and category are required',
        error: true,
        success: false,
      });
    }

    // Verify category exists
    const categoryExists = await BlogCategoryModel.findById(category);
    if (!categoryExists) {
      return response.status(400).json({
        message: 'Invalid category selected',
        error: true,
        success: false,
      });
    }

    // Verify tags exist if provided
    if (tags && tags.length > 0) {
      const validTags = await BlogTagModel.find({ _id: { $in: tags } });
      if (validTags.length !== tags.length) {
        return response.status(400).json({
          message: 'One or more invalid tags selected',
          error: true,
          success: false,
        });
      }
    }

    const newPost = new BlogPostModel({
      title: title.trim(),
      excerpt: excerpt.trim(),
      content,
      featuredImage,
      imageAlt: imageAlt?.trim(),
      category,
      tags: tags || [],
      author: request.userId,
      status: status || 'DRAFT',
      seoTitle: seoTitle?.trim() || title.trim(),
      seoDescription: seoDescription?.trim() || excerpt.trim(),
      seoKeywords: seoKeywords?.trim(),
      canonicalUrl: canonicalUrl?.trim(),
      socialTitle: socialTitle?.trim() || title.trim(),
      socialDescription: socialDescription?.trim() || excerpt.trim(),
      socialImage: socialImage || featuredImage,
      relatedProducts: relatedProducts || [],
    });

    const savedPost = await newPost.save();

    // Populate references
    const populatedPost = await BlogPostModel.findById(savedPost._id)
      .populate('category', 'name slug')
      .populate('tags', 'name slug color')
      .populate('author', 'name email')
      .populate('relatedProducts', 'name slug price images');

    return response.status(201).json({
      message: 'Blog post created successfully',
      data: populatedPost,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Create blog post error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to create blog post',
      error: true,
      success: false,
    });
  }
}

// Get all blog posts (admin)
export async function getBlogPostsController(request, response) {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      category,
      author,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = request.query;

    const query = {};

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { excerpt: { $regex: search, $options: 'i' } },
      ];
    }

    if (status) {
      query.status = status;
    }

    if (category) {
      query.category = category;
    }

    if (author) {
      query.author = author;
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const posts = await BlogPostModel.find(query)
      .populate('category', 'name slug')
      .populate('tags', 'name slug color')
      .populate('author', 'name email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await BlogPostModel.countDocuments(query);

    return response.json({
      message: 'Blog posts retrieved successfully',
      data: posts,
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
    console.error('Get blog posts error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog posts',
      error: true,
      success: false,
    });
  }
}

// Get blog post by ID
export async function getBlogPostController(request, response) {
  try {
    const { id } = request.params;

    const post = await BlogPostModel.findById(id)
      .populate('category', 'name slug description')
      .populate('tags', 'name slug color')
      .populate('author', 'name email avatar')
      .populate('relatedProducts', 'name slug price images discount');

    if (!post) {
      return response.status(404).json({
        message: 'Blog post not found',
        error: true,
        success: false,
      });
    }

    return response.json({
      message: 'Blog post retrieved successfully',
      data: post,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get blog post error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog post',
      error: true,
      success: false,
    });
  }
}

// Update blog post
export async function updateBlogPostController(request, response) {
  try {
    const { id } = request.params;
    const {
      title,
      excerpt,
      content,
      featuredImage,
      imageAlt,
      category,
      tags,
      status,
      featured, // ✅ ADDED: Handle featured field
      seoTitle,
      seoDescription,
      seoKeywords,
      canonicalUrl,
      socialTitle,
      socialDescription,
      socialImage,
      relatedProducts,
    } = request.body;

    const post = await BlogPostModel.findById(id);

    if (!post) {
      return response.status(404).json({
        message: 'Blog post not found',
        error: true,
        success: false,
      });
    }

    // Verify category exists if provided
    if (category) {
      const categoryExists = await BlogCategoryModel.findById(category);
      if (!categoryExists) {
        return response.status(400).json({
          message: 'Invalid category selected',
          error: true,
          success: false,
        });
      }
    }

    // Verify tags exist if provided
    if (tags && tags.length > 0) {
      const validTags = await BlogTagModel.find({ _id: { $in: tags } });
      if (validTags.length !== tags.length) {
        return response.status(400).json({
          message: 'One or more invalid tags selected',
          error: true,
          success: false,
        });
      }
    }

    const updateData = {};
    if (title) updateData.title = title.trim();
    if (excerpt) updateData.excerpt = excerpt.trim();
    if (content) updateData.content = content;
    if (featuredImage) updateData.featuredImage = featuredImage;
    if (imageAlt !== undefined) updateData.imageAlt = imageAlt?.trim();
    if (category) updateData.category = category;
    if (tags !== undefined) updateData.tags = tags;
    if (status) updateData.status = status;
    if (featured !== undefined) updateData.featured = Boolean(featured); // ✅ ADDED
    if (seoTitle !== undefined) updateData.seoTitle = seoTitle?.trim();
    if (seoDescription !== undefined)
      updateData.seoDescription = seoDescription?.trim();
    if (seoKeywords !== undefined) updateData.seoKeywords = seoKeywords?.trim();
    if (canonicalUrl !== undefined)
      updateData.canonicalUrl = canonicalUrl?.trim();
    if (socialTitle !== undefined) updateData.socialTitle = socialTitle?.trim();
    if (socialDescription !== undefined)
      updateData.socialDescription = socialDescription?.trim();
    if (socialImage !== undefined) updateData.socialImage = socialImage;
    if (relatedProducts !== undefined)
      updateData.relatedProducts = relatedProducts;

    const updatedPost = await BlogPostModel.findByIdAndUpdate(id, updateData, {
      new: true,
    })
      .populate('category', 'name slug')
      .populate('tags', 'name slug color')
      .populate('author', 'name email')
      .populate('relatedProducts', 'name slug price images');

    return response.json({
      message: 'Blog post updated successfully',
      data: updatedPost,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Update blog post error:', error);
    return response.status(500).json({
      message: error.message || 'Failed to update blog post',
      error: true,
      success: false,
    });
  }
}

//Toggle featured status endpoint
export async function toggleFeaturedBlogPostController(request, response) {
  try {
    const { id } = request.params;

    const post = await BlogPostModel.findById(id);

    if (!post) {
      return response.status(404).json({
        message: 'Blog post not found',
        error: true,
        success: false,
      });
    }

    // Toggle the featured status
    post.featured = !post.featured;
    await post.save();

    const updatedPost = await BlogPostModel.findById(id)
      .populate('category', 'name slug')
      .populate('tags', 'name slug color')
      .populate('author', 'name email');

    return response.json({
      message: `Blog post ${
        post.featured ? 'featured' : 'unfeatured'
      } successfully`,
      data: updatedPost,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Toggle featured blog post error:', error);
    return response.status(500).json({
      message: 'Failed to toggle featured status',
      error: true,
      success: false,
    });
  }
}

// Delete blog post
export async function deleteBlogPostController(request, response) {
  try {
    const { id } = request.params;

    const post = await BlogPostModel.findById(id);

    if (!post) {
      return response.status(404).json({
        message: 'Blog post not found',
        error: true,
        success: false,
      });
    }

    await BlogPostModel.findByIdAndDelete(id);

    return response.json({
      message: 'Blog post deleted successfully',
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Delete blog post error:', error);
    return response.status(500).json({
      message: 'Failed to delete blog post',
      error: true,
      success: false,
    });
  }
}

// Get public blog posts (for frontend)
export async function getPublicBlogPostsController(request, response) {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      tag,
      search,
      featured = false,
    } = request.query;

    const query = { status: 'PUBLISHED' };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { excerpt: { $regex: search, $options: 'i' } },
      ];
    }

    if (category) {
      // Support both ID and slug
      if (category.match(/^[0-9a-fA-F]{24}$/)) {
        query.category = category;
      } else {
        const categoryDoc = await BlogCategoryModel.findOne({ slug: category });
        if (categoryDoc) {
          query.category = categoryDoc._id;
        }
      }
    }

    if (tag) {
      // Support both ID and slug
      if (tag.match(/^[0-9a-fA-F]{24}$/)) {
        query.tags = tag;
      } else {
        const tagDoc = await BlogTagModel.findOne({ slug: tag });
        if (tagDoc) {
          query.tags = tagDoc._id;
        }
      }
    }

    const skip = (page - 1) * limit;

    const posts = await BlogPostModel.find(query)
      .populate('category', 'name slug')
      .populate('tags', 'name slug color')
      .populate('author', 'name')
      .select('-content')
      .sort({ publishedAt: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await BlogPostModel.countDocuments(query);

    return response.json({
      message: 'Blog posts retrieved successfully',
      data: posts,
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
    console.error('Get public blog posts error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog posts',
      error: true,
      success: false,
    });
  }
}

// Get blog post by slug (public)
export async function getBlogPostBySlugController(request, response) {
  try {
    const { slug } = request.params;

    const post = await BlogPostModel.findOne({
      slug,
      status: 'PUBLISHED',
    })
      .populate('category', 'name slug description')
      .populate('tags', 'name slug color')
      .populate('author', 'name avatar')
      .populate('relatedProducts', 'name slug price images discount');

    if (!post) {
      return response.status(404).json({
        message: 'Blog post not found',
        error: true,
        success: false,
      });
    }

    // Increment view count
    await BlogPostModel.findByIdAndUpdate(post._id, {
      $inc: { views: 1 },
    });

    return response.json({
      message: 'Blog post retrieved successfully',
      data: post,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get blog post by slug error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve blog post',
      error: true,
      success: false,
    });
  }
}

// Get featured posts
export async function getFeaturedBlogPostsController(request, response) {
  try {
    const { limit = 6 } = request.query;

    console.log('=== Featured Posts Request ===');
    console.log('Limit:', limit);

    // Check if any posts exist at all
    const totalPosts = await BlogPostModel.countDocuments();
    console.log('Total posts in database:', totalPosts);

    const publishedPosts = await BlogPostModel.countDocuments({
      status: 'PUBLISHED',
    });
    console.log('Published posts:', publishedPosts);

    const featuredCount = await BlogPostModel.countDocuments({
      status: 'PUBLISHED',
      featured: true,
    });
    console.log('Featured published posts:', featuredCount);

    const posts = await BlogPostModel.find({
      status: 'PUBLISHED',
      featured: true,
    })
      .populate('category', 'name slug')
      .populate('tags', 'name slug color')
      .populate('author', 'name')
      .select('-content')
      .sort({ publishedAt: 1 })
      .limit(parseInt(limit));

    console.log('Posts found:', posts.length);
    console.log('First post:', posts[0]?.title || 'No posts');
    console.log('=== End Featured Posts Request ===');

    return response.json({
      message: 'Featured blog posts retrieved successfully',
      data: posts,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get featured blog posts error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve featured blog posts',
      error: true,
      success: false,
    });
  }
}

// Get related posts
export async function getRelatedBlogPostsController(request, response) {
  try {
    const { id } = request.params;
    const { limit = 4 } = request.query;

    const currentPost = await BlogPostModel.findById(id);
    if (!currentPost) {
      return response.status(404).json({
        message: 'Blog post not found',
        error: true,
        success: false,
      });
    }

    const relatedPosts = await BlogPostModel.find({
      $and: [
        { _id: { $ne: id } },
        { status: 'PUBLISHED' },
        {
          $or: [
            { category: currentPost.category },
            { tags: { $in: currentPost.tags } },
          ],
        },
      ],
    })
      .populate('category', 'name slug')
      .populate('tags', 'name slug color')
      .populate('author', 'name')
      .select('-content')
      .sort({ publishedAt: -1 })
      .limit(parseInt(limit));

    return response.json({
      message: 'Related blog posts retrieved successfully',
      data: relatedPosts,
      error: false,
      success: true,
    });
  } catch (error) {
    console.error('Get related blog posts error:', error);
    return response.status(500).json({
      message: 'Failed to retrieve related blog posts',
      error: true,
      success: false,
    });
  }
}

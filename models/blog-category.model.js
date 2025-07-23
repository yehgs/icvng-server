// models/blogCategory.model.js
import mongoose from 'mongoose';

const blogCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxLength: [100, 'Category name cannot exceed 100 characters'],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxLength: [500, 'Description cannot exceed 500 characters'],
    },
    image: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
    },
    seoTitle: {
      type: String,
      trim: true,
      maxLength: [60, 'SEO title cannot exceed 60 characters'],
    },
    seoDescription: {
      type: String,
      trim: true,
      maxLength: [160, 'SEO description cannot exceed 160 characters'],
    },
    seoKeywords: {
      type: String,
      trim: true,
    },
    postCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Create slug from name before saving
blogCategorySchema.pre('save', function (next) {
  if (this.isModified('name') || this.isNew) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

// Update post count
blogCategorySchema.methods.updatePostCount = async function () {
  const BlogPost = mongoose.model('BlogPost');
  this.postCount = await BlogPost.countDocuments({
    category: this._id,
    status: 'PUBLISHED',
  });
  await this.save();
};

const BlogCategoryModel = mongoose.model('BlogCategory', blogCategorySchema);

export default BlogCategoryModel;

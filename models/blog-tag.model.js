// models/blogTag.model.js
import mongoose from 'mongoose';

const blogTagSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Tag name is required'],
      trim: true,
      maxLength: [50, 'Tag name cannot exceed 50 characters'],
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
      maxLength: [200, 'Description cannot exceed 200 characters'],
    },
    color: {
      type: String,
      default: '#3B82F6',
    },
    postCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
    },
  },
  {
    timestamps: true,
  }
);

// Create slug from name before saving
blogTagSchema.pre('save', function (next) {
  if (this.isModified('name') || this.isNew) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

// Update post count
blogTagSchema.methods.updatePostCount = async function () {
  const BlogPost = mongoose.model('BlogPost');
  this.postCount = await BlogPost.countDocuments({
    tags: this._id,
    status: 'PUBLISHED',
  });
  await this.save();
};

const BlogTagModel = mongoose.model('BlogTag', blogTagSchema);

export default BlogTagModel;

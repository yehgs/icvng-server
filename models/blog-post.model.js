// models/blogPost.model.js
import mongoose from "mongoose";

const blogPostSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxLength: [200, "Title cannot exceed 200 characters"],
    },
    slug: {
      type: String,
      required: false,
      unique: true,
      lowercase: true,
      trim: true,
    },
    excerpt: {
      type: String,
      required: [true, "Excerpt is required"],
      trim: true,
      maxLength: [300, "Excerpt cannot exceed 300 characters"],
    },
    content: {
      type: String,
      required: [true, "Content is required"],
    },
    featuredImage: {
      type: String,
      required: [true, "Featured image is required"],
    },
    imageAlt: {
      type: String,
      trim: true,
      maxLength: [100, "Image alt text cannot exceed 100 characters"],
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BlogCategory",
      required: [true, "Category is required"],
    },
    tags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BlogTag",
      },
    ],
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Author is required"],
    },
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      default: "DRAFT",
    },
    publishedAt: {
      type: Date,
    },
    readTime: {
      type: Number, // in minutes
      default: 0,
    },
    views: {
      type: Number,
      default: 0,
    },
    likes: {
      type: Number,
      default: 0,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    // SEO Fields
    seoTitle: {
      type: String,
      trim: true,
      maxLength: [60, "SEO title cannot exceed 60 characters"],
    },
    seoDescription: {
      type: String,
      trim: true,
      maxLength: [160, "SEO description cannot exceed 160 characters"],
    },
    seoKeywords: {
      type: String,
      trim: true,
    },
    canonicalUrl: {
      type: String,
      trim: true,
    },
    // Schema.org structured data
    schemaType: {
      type: String,
      enum: ["Article", "BlogPosting", "NewsArticle"],
      default: "BlogPosting",
    },
    // Social Media
    socialImage: {
      type: String,
    },
    socialTitle: {
      type: String,
      trim: true,
      maxLength: [100, "Social title cannot exceed 100 characters"],
    },
    socialDescription: {
      type: String,
      trim: true,
      maxLength: [200, "Social description cannot exceed 200 characters"],
    },
    // Related Products (for coffee origin posts)
    relatedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Create slug from title before saving
blogPostSchema.pre("save", function (next) {
  if (this.isModified("title") || this.isNew) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  // Set published date when status changes to PUBLISHED
  if (
    this.isModified("status") &&
    this.status === "PUBLISHED" &&
    !this.publishedAt
  ) {
    this.publishedAt = new Date();
  }

  // Calculate read time (average 200 words per minute)
  if (this.isModified("content")) {
    const wordCount = this.content.replace(/<[^>]*>/g, "").split(/\s+/).length;
    this.readTime = Math.ceil(wordCount / 200);
  }

  next();
});

// Index for SEO and performance
blogPostSchema.index({ category: 1, status: 1 });
blogPostSchema.index({ tags: 1, status: 1 });
blogPostSchema.index({ status: 1, publishedAt: -1 });
blogPostSchema.index({ author: 1, status: 1 });

// Update category and tag post counts after save
blogPostSchema.post("save", async function () {
  if (this.category) {
    const BlogCategory = mongoose.model("BlogCategory");
    const category = await BlogCategory.findById(this.category);
    if (category) {
      await category.updatePostCount();
    }
  }

  if (this.tags && this.tags.length > 0) {
    const BlogTag = mongoose.model("BlogTag");
    for (const tagId of this.tags) {
      const tag = await BlogTag.findById(tagId);
      if (tag) {
        await tag.updatePostCount();
      }
    }
  }
});

const BlogPostModel = mongoose.model("BlogPost", blogPostSchema);

export default BlogPostModel;

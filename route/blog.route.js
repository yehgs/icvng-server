// route/blog.route.js
import { Router } from 'express';
import {
  createBlogCategoryController,
  getBlogCategoriesController,
  getBlogCategoryController,
  updateBlogCategoryController,
  deleteBlogCategoryController,
  getPublicBlogCategoriesController,
} from '../controllers/blogCategory.controller.js';
import {
  createBlogTagController,
  getBlogTagsController,
  getBlogTagController,
  updateBlogTagController,
  deleteBlogTagController,
  getPublicBlogTagsController,
} from '../controllers/blogTag.controller.js';
import {
  createBlogPostController,
  getBlogPostsController,
  getBlogPostController,
  updateBlogPostController,
  deleteBlogPostController,
  getPublicBlogPostsController,
  getBlogPostBySlugController,
  getFeaturedBlogPostsController,
  getRelatedBlogPostsController,
  toggleFeaturedBlogPostController,
} from '../controllers/blogPost.controller.js';
import auth from '../middleware/auth.js';
import blogAuth from '../middleware/blogAuth.js';

const blogRouter = Router();

// Public routes (no authentication needed)
blogRouter.get('/public/categories', getPublicBlogCategoriesController);
blogRouter.get('/public/tags', getPublicBlogTagsController);
blogRouter.get('/public/posts', getPublicBlogPostsController);
blogRouter.get('/public/posts/featured', getFeaturedBlogPostsController);
blogRouter.get('/public/posts/slug/:slug', getBlogPostBySlugController);
blogRouter.get('/public/posts/:id/related', getRelatedBlogPostsController);

// Admin routes (authentication + admin role required)
// Blog Categories
blogRouter.post(
  '/admin/categories',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  createBlogCategoryController
);
blogRouter.get(
  '/admin/categories',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  getBlogCategoriesController
);
blogRouter.get(
  '/admin/categories/:id',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  getBlogCategoryController
);
blogRouter.put(
  '/admin/categories/:id',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  updateBlogCategoryController
);
blogRouter.delete(
  '/admin/categories/:id',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  deleteBlogCategoryController
);

// Blog Tags
blogRouter.post(
  '/admin/tags',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  createBlogTagController
);
blogRouter.get(
  '/admin/tags',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  getBlogTagsController
);
blogRouter.get(
  '/admin/tags/:id',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  getBlogTagController
);
blogRouter.put(
  '/admin/tags/:id',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  updateBlogTagController
);
blogRouter.delete(
  '/admin/tags/:id',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  deleteBlogTagController
);

// Blog Posts
blogRouter.post(
  '/admin/posts',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  createBlogPostController
);
blogRouter.get(
  '/admin/posts',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  getBlogPostsController
);
blogRouter.get(
  '/admin/posts/:id',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  getBlogPostController
);
blogRouter.put(
  '/admin/posts/:id',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  updateBlogPostController
);
blogRouter.patch(
  '/admin/posts/:id/toggle-featured',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  toggleFeaturedBlogPostController
);
blogRouter.delete(
  '/admin/posts/:id',
  auth,
  blogAuth(['EDITOR', 'IT', 'DIRECTOR']),
  deleteBlogPostController
);

export default blogRouter;

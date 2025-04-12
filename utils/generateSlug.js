// Utility function to generate a slug
const generateSlug = (name) => {
  return name
    .toLowerCase() // convert to lowercase
    .trim() // remove leading/trailing whitespace
    .replace(/[^\w\s-]/g, '') // remove non-word chars (except spaces and hyphens)
    .replace(/[\s_]+/g, '-') // replace spaces or underscores with a single dash
    .replace(/-+/g, '-') // replace multiple dashes with a single dash
    .replace(/^-+|-+$/g, ''); // remove leading/trailing dashes
};

export default generateSlug;

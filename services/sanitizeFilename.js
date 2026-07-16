const sanitizeFilename = (filename) => {
  return filename
    ? filename
      .replace(/[*?:<>"|\\/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100)
    : 'note';
};

module.exports = {
  sanitizeFilename,
};

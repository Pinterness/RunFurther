function notImplemented(feature) {
  return (_req, res) =>
    res.status(501).json({
      message: `${feature} is planned but not implemented yet.`,
    });
}

module.exports = { notImplemented };

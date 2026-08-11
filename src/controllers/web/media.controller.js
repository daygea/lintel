'use strict';

const mediaService = require('../../services/media.service');
const { isConfigured } = require('../../lib/storage');

exports.uploadPage = async (req, res, next) => {
  try {
    res.render('media/upload', { error: null });
  } catch (err) { next(err); }
};

exports.listAssets = async (req, res, next) => {
  try {
    const assets = await mediaService.listAssets();
    res.render('media/assets', { assets, storageReady: isConfigured() });
  } catch (err) {
    next(err);
  }
};

exports.getAsset = async (req, res, next) => {
  try {
    const asset = await mediaService.getAsset(req.params.id);
    res.render('media/asset', { asset, error: null });
  } catch (err) {
    next(err);
  }
};

exports.rename = async (req, res, next) => {
  try {
    await mediaService.renameAsset(req.params.id, req.body.filename);
    res.redirect('/media/' + req.params.id);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await mediaService.deleteAsset(req.params.id);
    res.redirect('/media');
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      const asset = await mediaService.getAsset(req.params.id).catch(() => null);
      if (asset) return res.status(422).render('media/asset', { asset, error: err.message });
    }
    next(err);
  }
};

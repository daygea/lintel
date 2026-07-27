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
    res.render('media/asset', { asset });
  } catch (err) {
    next(err);
  }
};

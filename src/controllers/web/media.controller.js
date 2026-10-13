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
    res.render('media/asset', {
      asset,
      error: null,
      saved: req.query.saved || null,
      locales: (req.tenant && req.tenant.locales) || ['en'],
      defaultLocale: (req.tenant && req.tenant.defaultLocale) || 'en',
    });
  } catch (err) {
    next(err);
  }
};

exports.saveTranscript = async (req, res, next) => {
  try {
    const loc = (req.tenant && req.tenant.defaultLocale) || 'en';
    await mediaService.setTranscript(req.params.id, { [loc]: req.body.transcript || '' });
    res.redirect('/media/' + req.params.id + '?saved=transcript');
  } catch (err) {
    next(err);
  }
};

exports.addCaption = async (req, res, next) => {
  try {
    await mediaService.setCaption(req.params.id, { locale: req.body.locale, vtt: req.body.vtt });
    res.redirect('/media/' + req.params.id + '?saved=captions');
  } catch (err) {
    if (err.status === 422 || err.name === 'ValidationError') {
      const asset = await mediaService.getAsset(req.params.id).catch(() => null);
      if (asset) {
        return res.status(422).render('media/asset', {
          asset, error: err.message, saved: null,
          locales: (req.tenant && req.tenant.locales) || ['en'],
          defaultLocale: (req.tenant && req.tenant.defaultLocale) || 'en',
        });
      }
    }
    next(err);
  }
};

exports.removeCaption = async (req, res, next) => {
  try {
    await mediaService.removeCaption(req.params.id, req.params.locale);
    res.redirect('/media/' + req.params.id + '?saved=captions');
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

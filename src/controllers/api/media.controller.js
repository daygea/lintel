'use strict';

const mediaService = require('../../services/media.service');

exports.beginUpload = async (req, res, next) => {
  try {
    res.status(201).json(await mediaService.beginUpload(req.body));
  } catch (err) {
    next(err);
  }
};

exports.completeUpload = async (req, res, next) => {
  try {
    res.json({ asset: await mediaService.completeUpload(req.params.id, req.body) });
  } catch (err) {
    next(err);
  }
};

exports.abandonUpload = async (req, res, next) => {
  try {
    await mediaService.abandonUpload(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.listAssets = async (req, res, next) => {
  try {
    res.json({ assets: await mediaService.listAssets() });
  } catch (err) {
    next(err);
  }
};

exports.getAsset = async (req, res, next) => {
  try {
    res.json({ asset: await mediaService.getAsset(req.params.id) });
  } catch (err) {
    next(err);
  }
};

exports.playbackUrl = async (req, res, next) => {
  try {
    res.json(await mediaService.playbackUrl(req.params.id, { rung: req.query.rung }));
  } catch (err) {
    next(err);
  }
};

exports.setTranscript = async (req, res, next) => {
  try {
    res.json({ asset: await mediaService.setTranscript(req.params.id, req.body.transcript) });
  } catch (err) {
    next(err);
  }
};

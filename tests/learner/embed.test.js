'use strict';

/**
 * External lecture links. classifyEmbed turns an author-supplied URL into a
 * render instruction: an embeddable player for YouTube/Vimeo, a native player for
 * direct media, or a plain link for anything else.
 */

const { classifyEmbed } = require('../../src/services/learner.service');

it('normalises YouTube URLs (watch, youtu.be, shorts, embed, extra params) to the embed player', () => {
  const id = 'dQw4w9WgXcQ';
  const expected = `https://www.youtube.com/embed/${id}`;
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?feature=share&v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
  ]) {
    const r = classifyEmbed(url);
    expect(r.kind).toBe('youtube');
    expect(r.src).toBe(expected);
  }
});

it('normalises Vimeo URLs to the player', () => {
  const r = classifyEmbed('https://vimeo.com/76979871');
  expect(r.kind).toBe('vimeo');
  expect(r.src).toBe('https://player.vimeo.com/video/76979871');
});

it('detects direct video files (incl. with a query string)', () => {
  expect(classifyEmbed('https://cdn.example.com/lecture.mp4').kind).toBe('video');
  expect(classifyEmbed('https://x.io/a.webm').kind).toBe('video');
  expect(classifyEmbed('https://x.io/a.mp4?token=abc').kind).toBe('video');
});

it('detects direct audio files', () => {
  expect(classifyEmbed('https://cdn.example.com/talk.mp3').kind).toBe('audio');
  expect(classifyEmbed('https://x.io/a.m4a').kind).toBe('audio');
});

it('falls back to a plain link for anything else', () => {
  const r = classifyEmbed('https://drive.google.com/file/d/abc123/view');
  expect(r.kind).toBe('link');
  expect(r.url).toBe('https://drive.google.com/file/d/abc123/view');
});

it('is safe on empty input', () => {
  expect(classifyEmbed('').kind).toBe('link');
  expect(classifyEmbed(undefined).kind).toBe('link');
});

'use strict';

const mongoose = require('mongoose');
const { fold, pick } = require('../../src/plugins/locale-map');
const { runWithTenant } = require('../../src/lib/context');
const { Lesson } = require('../../src/models');

const fakeTenant = new mongoose.Types.ObjectId();

describe('diacritic folding', () => {
  it('strips Yorùbá tone marks and sub-dots', () => {
    expect(fold('Oríkì')).toBe('oriki');
    expect(fold('Àyànmọ́')).toBe('ayanmo');
    expect(fold('Ìtẹ̀fá')).toBe('itefa');
    expect(fold('Ọ̀rúnmìlà')).toBe('orunmila');
  });

  it('leaves plain text alone', () => {
    expect(fold('cosmology')).toBe('cosmology');
  });
});

describe('locale maps', () => {
  it('picks the requested locale, falling back to English', () => {
    const title = { en: 'Divination', yo: 'Ìdáfá' };
    expect(pick(title, 'yo')).toBe('Ìdáfá');
    expect(pick(title, 'en')).toBe('Divination');
    expect(pick(title, 'fr')).toBe('Divination');
  });
});

describe('the search shadow field', () => {
  it('is built from every locale, folded, on validate', async () => {
    // validate() needs no database connection.
    await runWithTenant(fakeTenant, null, () => {
      const lesson = new Lesson({
        moduleId: new mongoose.Types.ObjectId(),
        courseId: new mongoose.Types.ObjectId(),
        title: { en: 'Recitation of Oríkì', yo: 'Ìkíni Oríkì' },
      });
      return lesson.validate().then(() => {
        const shadow = lesson.get('title__search');
        expect(shadow).toContain('oriki');
        expect(shadow).toContain('recitation');
        expect(shadow).toContain('ikini');
        // display stays correct
        expect(lesson.title.get('en')).toBe('Recitation of Oríkì');
      });
    });
  });
});

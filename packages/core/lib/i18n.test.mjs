import test from 'node:test';
import assert from 'node:assert/strict';
import { loadI18n } from './i18n.mjs';

test('loads the Taiwan Traditional Chinese locale without falling back', () => {
  const locale = loadI18n({ locale: 'zh-TW' });
  assert.equal(locale.locale, 'zh-TW');
  assert.equal(locale.t('states.INIT'), '已初始化，待填寫需求');
});

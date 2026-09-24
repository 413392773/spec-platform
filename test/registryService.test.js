import test from 'node:test';
import assert from 'node:assert/strict';
import { listModes, getMode, getMasterVersion } from '../src/services/registryService.js';

test('listModes 返回注册表条目并含默认模式', () => {
  const modes = listModes();
  assert.ok(Array.isArray(modes) && modes.length >= 1);
  const large = modes.find((m) => m.name === 'spec-large-self');
  assert.ok(large, '注册表应包含 spec-large-self');
  assert.equal(large.default, true);
  assert.equal(typeof large.label, 'string');
  assert.equal(typeof large.version, 'number');
});

test('getMode 未知模式返回 undefined', () => {
  assert.equal(getMode('not-exist-mode'), undefined);
  assert.ok(getMode('spec-large-self'));
});

test('getMasterVersion 读取母本 schema.yaml 版本并与注册表一致', () => {
  const info = getMasterVersion('spec-large-self');
  assert.equal(info.version, 2);
  assert.equal(info.matchesRegistry, true);
});

test('getMasterVersion 未知模式返回 null', () => {
  assert.equal(getMasterVersion('not-exist'), null);
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { getTemplatesDir } from '../lib/paths.js';

const registryPath = () => join(getTemplatesDir(), 'registry.yaml');

function loadRegistry() {
  const doc = YAML.parse(readFileSync(registryPath(), 'utf8'));
  const schemas = doc?.schemas;
  if (!Array.isArray(schemas)) {
    throw new Error('registry.yaml 损坏：缺少 schemas 数组');
  }
  return schemas;
}

/** 全部模式（副本，防外部修改内部状态） */
export function listModes() {
  return loadRegistry().map((entry) => ({ ...entry }));
}

/** 按名取模式；未知返回 undefined */
export function getMode(name) {
  const found = loadRegistry().find((entry) => entry.name === name);
  return found ? { ...found } : undefined;
}

/** 母本目录 templates/schemas/<name> */
export function getMasterDir(name) {
  return join(getTemplatesDir(), name);
}

/** 读母本 schema.yaml 的 version 并与注册表核对；未知模式返回 null */
export function getMasterVersion(name) {
  const entry = getMode(name);
  if (!entry) return null;
  const schemaDoc = YAML.parse(
    readFileSync(join(getMasterDir(name), 'schema.yaml'), 'utf8'),
  );
  const version = schemaDoc?.version;
  return {
    version,
    matchesRegistry: version === entry.version,
    masterDir: getMasterDir(name),
  };
}

/** 读母本默认 rules（config.rules.yaml） */
export function getMasterRules(name) {
  const doc = YAML.parse(
    readFileSync(join(getMasterDir(name), 'config.rules.yaml'), 'utf8'),
  );
  return doc?.rules ?? {};
}

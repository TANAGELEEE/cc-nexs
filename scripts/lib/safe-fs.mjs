import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const PRESET_NAME_RE = /^preset-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertPresetName(name) {
  if (typeof name !== 'string' || !PRESET_NAME_RE.test(name)) {
    throw new Error(`invalid preset name: ${JSON.stringify(name)}`);
  }
  return name;
}
export function assertWithin(root, candidate, { allowRoot = false } = {}) {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const rel = relative(rootPath, candidatePath);
  const isInside = rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(`../`);
  if ((!allowRoot && rel === '') || (rel !== '' && !isInside)) {
    throw new Error(`path escapes allowed root: ${candidatePath}`);
  }
  return candidatePath;
}

export function safeRemoveWithin(root, candidate) {
  const target = assertWithin(root, candidate);
  rmSync(target, { recursive: true, force: true });
}

export function copyTreeNoSymlinks(src, dst, options = {}) {
  const sourceRoot = resolve(src);
  const destinationRoot = resolve(dst);
  const { skipExisting = false, exclude = () => false } = options;

  if (!existsSync(sourceRoot)) return 0;
  assertNoSymlink(sourceRoot);
  mkdirSync(destinationRoot, { recursive: true });
  return copyDirectory(sourceRoot, destinationRoot, sourceRoot, {
    skipExisting,
    exclude,
  });
}

function copyDirectory(current, destination, sourceRoot, options) {
  let copied = 0;
  for (const entry of readdirSync(current).sort()) {
    const sourcePath = resolve(current, entry);
    const destinationPath = resolve(destination, entry);
    assertWithin(sourceRoot, sourcePath, { allowRoot: true });
    if (options.exclude(sourcePath, entry)) continue;

    const stat = lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`symlink is not allowed in plugin sources: ${sourcePath}`);
    }
    if (stat.isDirectory()) {
      mkdirSync(destinationPath, { recursive: true });
      copied += copyDirectory(sourcePath, destinationPath, sourceRoot, options);
    } else if (stat.isFile()) {
      if (options.skipExisting && existsSync(destinationPath)) continue;
      mkdirSync(resolve(destinationPath, '..'), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
      copied += 1;
    } else {
      throw new Error(`unsupported file type in plugin sources: ${sourcePath}`);
    }
  }
  return copied;
}

function assertNoSymlink(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`symlink is not allowed in plugin sources: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`expected directory: ${path}`);
  }
}

import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function writeTextAtomic(path, text) {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const temporary = join(parent, `.${randomUUID()}.cc-nexs.tmp`);
  const backup = join(parent, `.${randomUUID()}.cc-nexs.bak`);
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : undefined;
  let movedOriginal = false;
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', mode });
    if (existsSync(path)) {
      renameSync(path, backup);
      movedOriginal = true;
    }
    renameSync(temporary, path);
    rmSync(backup, { force: true });
    movedOriginal = false;
  } catch (error) {
    if (movedOriginal && !existsSync(path) && existsSync(backup)) renameSync(backup, path);
    throw error;
  } finally {
    rmSync(temporary, { force: true });
    if (!movedOriginal) rmSync(backup, { force: true });
  }
}

export function writeJsonAtomic(path, value) {
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

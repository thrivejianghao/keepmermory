import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LocalStorageProvider } from '../src/index.js';

describe('LocalStorageProvider', () => {
  it('saves, reads, creates a URL, and deletes an object', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'ai-photo-storage-'));
    const storage = new LocalStorageProvider({ rootDir });
    const objectKey = 'uploads/photo.jpg';

    await storage.save(Buffer.from('photo'), objectKey);

    expect(await storage.read(objectKey)).toEqual(Buffer.from('photo'));
    expect(await storage.getUrl(objectKey)).toBe('/api/v1/files/uploads/photo.jpg');
    expect(await readFile(join(rootDir, objectKey))).toEqual(Buffer.from('photo'));

    await storage.delete(objectKey);
    await expect(storage.read(objectKey)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects path traversal instead of escaping the storage root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'ai-photo-storage-'));
    const storage = new LocalStorageProvider({ rootDir });

    await expect(storage.save(Buffer.from('secret'), '../secret.txt')).rejects.toThrow('INVALID_OBJECT_KEY');
  });
});

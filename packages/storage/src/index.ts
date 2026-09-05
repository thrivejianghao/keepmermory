import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

export interface StorageProvider {
  save(file: Buffer, objectKey: string): Promise<string>;
  read(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
  getUrl(objectKey: string): Promise<string>;
}

export interface LocalStorageOptions {
  rootDir: string;
  publicBaseUrl?: string;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly rootDir: string;
  private readonly publicBaseUrl: string;

  public constructor(options: LocalStorageOptions) {
    this.rootDir = resolve(options.rootDir);
    this.publicBaseUrl = options.publicBaseUrl ?? '/api/v1/files';
  }

  public async save(file: Buffer, objectKey: string): Promise<string> {
    const path = this.resolveSafe(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file, { flag: 'w' });
    return objectKey.replaceAll('\\', '/');
  }

  public async read(objectKey: string): Promise<Buffer> {
    return readFile(this.resolveSafe(objectKey));
  }

  public async delete(objectKey: string): Promise<void> {
    await unlink(this.resolveSafe(objectKey));
  }

  public async getUrl(objectKey: string): Promise<string> {
    return `${this.publicBaseUrl}/${encodeURIComponent(objectKey).replaceAll('%2F', '/')}`;
  }

  private resolveSafe(objectKey: string): string {
    if (!objectKey || isAbsolute(objectKey)) throw new Error('INVALID_OBJECT_KEY');
    const normalized = normalize(objectKey);
    const path = resolve(join(this.rootDir, normalized));
    const containment = relative(this.rootDir, path);
    if (containment.startsWith('..') || isAbsolute(containment)) throw new Error('INVALID_OBJECT_KEY');
    return path;
  }
}

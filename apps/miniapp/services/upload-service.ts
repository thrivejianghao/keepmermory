import { api, type ApiClient, type UploadResult } from './api';

export interface SelectedImage { path: string; size: number; width?: number; height?: number }
export interface UploadProgress { completed: number; total: number }

interface MediaRuntime {
  chooseMedia(options: Record<string, unknown>): void;
  compressImage(options: Record<string, unknown>): void;
  downloadFile?(options: Record<string, unknown>): void;
  saveImageToPhotosAlbum?(options: Record<string, unknown>): void;
}

const COMPRESSION_THRESHOLD = 1024 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MIN_IMAGE_EDGE = 256;

const isCancel = (reason: unknown): boolean => Boolean(reason && typeof reason === 'object' && 'errMsg' in reason && typeof reason.errMsg === 'string' && reason.errMsg.includes('cancel'));

export function createUploadService(client: ApiClient, media: MediaRuntime) {
  const choose = (count: number): Promise<SelectedImage[]> => new Promise((resolve, reject) => {
    media.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result: WechatMiniprogram.ChooseMediaSuccessCallbackResult) => resolve(result.tempFiles.map((file) => ({ path: file.tempFilePath, size: file.size, ...(file.width ? { width: file.width } : {}), ...(file.height ? { height: file.height } : {}) }))),
      fail: (reason: unknown) => reject(new Error(isCancel(reason) ? 'PHOTO_SELECTION_CANCELLED' : '无法读取照片，请检查相册或相机权限')),
    });
  });

  const compress = (image: SelectedImage): Promise<string> => {
    if (image.size > MAX_SOURCE_BYTES) return Promise.reject(new Error('单张图片不能超过 25 MB'));
    if (image.width && image.height && Math.min(image.width, image.height) < MIN_IMAGE_EDGE) return Promise.reject(new Error(`图片尺寸过小，短边至少需要 ${MIN_IMAGE_EDGE} 像素`));
    if (image.size <= COMPRESSION_THRESHOLD) return Promise.resolve(image.path);
    return new Promise((resolve, reject) => media.compressImage({
      src: image.path,
      quality: 82,
      compressedWidth: 2048,
      success: (result: { tempFilePath: string }) => resolve(result.tempFilePath),
      fail: () => reject(new Error('图片压缩失败，请换一张照片重试')),
    }));
  };

  return {
    choose,
    async prepareAndUpload(images: SelectedImage[], onProgress?: (progress: UploadProgress) => void): Promise<UploadResult[]> {
      const uploads: UploadResult[] = [];
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        if (!image) continue;
        const path = await compress(image);
        uploads.push(await client.upload(path));
        onProgress?.({ completed: index + 1, total: images.length });
      }
      return uploads;
    },
    saveToAlbum(url: string): Promise<void> {
      if (!media.downloadFile || !media.saveImageToPhotosAlbum) return Promise.reject(new Error('当前环境不支持保存图片'));
      return new Promise((resolve, reject) => media.downloadFile!({
        url,
        success: (download: WechatMiniprogram.DownloadFileSuccessCallbackResult) => {
          if (download.statusCode < 200 || download.statusCode >= 300) { reject(new Error('图片下载失败')); return; }
          media.saveImageToPhotosAlbum!({
            filePath: download.tempFilePath,
            success: () => resolve(),
            fail: (reason: unknown) => {
              const message = reason && typeof reason === 'object' && 'errMsg' in reason && typeof reason.errMsg === 'string' ? reason.errMsg : '';
              reject(new Error(message.includes('auth deny') || message.includes('authorize') ? 'PHOTO_ALBUM_PERMISSION_DENIED' : '图片保存失败，请稍后重试'));
            },
          });
        },
        fail: () => reject(new Error('图片下载失败，请检查网络后重试')),
      }));
    },
  };
}

export const uploadService = createUploadService(api, wx);

declare const wx: {
  request(options: Record<string, unknown>): void;
  uploadFile(options: Record<string, unknown>): void;
  chooseMedia(options: Record<string, unknown>): void;
  previewImage(options: Record<string, unknown>): void;
  saveImageToPhotosAlbum(options: Record<string, unknown>): void;
  downloadFile(options: Record<string, unknown>): void;
  navigateTo(options: { url: string }): void;
  switchTab(options: { url: string }): void;
  showToast(options: Record<string, unknown>): void;
  showModal(options: Record<string, unknown>): void;
};
declare function setTimeout(handler: () => void, timeout: number): number;
declare function clearTimeout(handle: number): void;
declare function App(config: Record<string, unknown>): void;
declare function Page<D extends Record<string, unknown>, O extends Record<string, unknown>>(
  config: { data: D } & O & ThisType<O & { data: D; setData(patch: Partial<D>): void }>,
): void;
declare function Component<T extends Record<string, unknown>>(
  config: T & ThisType<T & { data: Record<string, unknown> }>,
): void;
declare function getApp<T = { globalData: { apiBaseUrl: string } }>(): T;
declare namespace WechatMiniprogram { interface RequestSuccessCallbackResult { data: unknown; statusCode: number } interface UploadFileSuccessCallbackResult { data: string; statusCode: number } interface ChooseMediaSuccessCallbackResult { tempFiles: Array<{ tempFilePath: string; size: number }> } interface DownloadFileSuccessCallbackResult { tempFilePath: string; statusCode: number } }

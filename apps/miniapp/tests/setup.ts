const root = globalThis as unknown as {
  wx: Record<string, (...args: unknown[]) => unknown>;
  getApp: () => { globalData: { apiBaseUrl: string } };
};

root.wx = {
  request: () => undefined,
  uploadFile: () => undefined,
  chooseMedia: () => undefined,
  compressImage: () => undefined,
};
root.getApp = () => ({ globalData: { apiBaseUrl: 'http://127.0.0.1:3000/api/v1' } });

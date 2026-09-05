declare namespace NodeJS {
  interface ProcessEnv {
    readonly ADMIN_PORT?: string;
    readonly AI_PROVIDER?: 'mock' | 'openai';
    readonly API_PORT?: string;
    readonly DATABASE_URL?: string;
    readonly NODE_ENV?: 'development' | 'test' | 'production';
    readonly OPENAI_API_KEY?: string;
    readonly REDIS_URL?: string;
  }
}

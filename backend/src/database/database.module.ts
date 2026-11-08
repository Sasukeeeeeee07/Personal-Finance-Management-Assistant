import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { createDatabase } from './connection';
import { migrate } from './migrator';
import type { DB } from './schema';

export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: async (config: AppConfig): Promise<DB> => {
        const db = createDatabase(config);
        const logger = new Logger('Database');
        if (!config.databaseUrl) logger.warn('DATABASE_URL not set: using embedded PGlite (development only).');
        await migrate(db, (m) => logger.log(m));
        return db;
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly db: DB) {}
  async onModuleDestroy() {
    await this.db.destroy();
  }
}

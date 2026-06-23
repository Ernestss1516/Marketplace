import { config } from 'dotenv';
import { join } from 'path';

// Loads .env.test into process.env before any test module is imported.
// Runs in each Jest worker via setupFiles — ensures MEILI_INDEX_NAME and
// DATABASE_URL are set before NestJS modules evaluate their module-level constants.
config({ path: join(__dirname, '..', '.env.test') });

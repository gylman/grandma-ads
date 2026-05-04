import { PersistenceAdapterPort } from '../../application/ports/persistence';
import { AppConfig } from '../../config';
import { createInMemoryPersistenceAdapter } from './inMemoryPersistenceAdapter';
import { createJsonFilePersistenceAdapter } from './jsonFilePersistenceAdapter';
import { createMongoPersistenceAdapter } from './mongodb/mongoPersistenceAdapter';

export async function createPersistenceAdapter(config: AppConfig): Promise<PersistenceAdapterPort> {
  if (config.persistenceMode === 'mongodb') {
    return createMongoPersistenceAdapter(config);
  }

  if (config.persistenceMode === 'json') {
    return createJsonFilePersistenceAdapter(config.jsonDatabasePath);
  }

  return createInMemoryPersistenceAdapter();
}

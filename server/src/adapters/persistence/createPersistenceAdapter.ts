import { PersistenceAdapterPort } from '../../application/ports/persistence';
import { AppConfig } from '../../config';
import { createInMemoryPersistenceAdapter } from './inMemoryPersistenceAdapter';
import { createMongoPersistenceAdapter } from './mongodb/mongoPersistenceAdapter';

export async function createPersistenceAdapter(config: AppConfig): Promise<PersistenceAdapterPort> {
  if (config.persistenceMode === 'mongodb') {
    return createMongoPersistenceAdapter(config);
  }

  return createInMemoryPersistenceAdapter();
}

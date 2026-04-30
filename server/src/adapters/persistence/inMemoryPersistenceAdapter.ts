import { PersistenceAdapterPort } from '../../application/ports/persistence';
import { createInMemoryRepositories } from './inMemoryRepositories';

export function createInMemoryPersistenceAdapter(): PersistenceAdapterPort {
  return {
    repositories: createInMemoryRepositories(),
    async close() {},
  };
}

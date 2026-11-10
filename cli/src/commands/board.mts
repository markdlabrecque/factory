// Board controls delegate to the current host's user service manager.
import { boardURL } from '../paths.mts';
import type { ServiceBackend } from '../platform/index.mts';
export async function board(service: ServiceBackend, action: string) {
  if (action === 'start') await service.start();
  else if (action === 'stop') await service.stop();
  else if (action === 'status') console.log(`${await service.status()}\n${boardURL}`);
  else throw new Error('Usage: factory board start|stop|status');
}

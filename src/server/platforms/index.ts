import { formitable } from './formitable.js';
import { guestplan } from './guestplan.js';
import { sevenrooms } from './sevenrooms.js';
import { tebi } from './tebi.js';
import { zenchef } from './zenchef.js';
import type { Platform } from './types.js';

/** Every booking system Seated can read. The key is the `platform` value in data/restaurants.json. */
export function createPlatforms({ onUidChange }: { onUidChange?: (restaurantId: string, uid: string) => void } = {}): Record<
  string,
  Platform
> {
  return {
    formitable: formitable(),
    tebi: tebi({ onUidChange }),
    sevenrooms: sevenrooms(),
    guestplan: guestplan(),
    zenchef: zenchef(),
  };
}

/** Demo mode: the same systems, all answered by the fake platform. Only Formitable can "book", as in real life. */
export function demoPlatforms(demo: Platform): Record<string, Platform> {
  const readOnly = (id: string, label: string): Platform => ({ ...demo, id, label: `${label} (demo)`, book: undefined });
  return {
    formitable: demo,
    tebi: readOnly('tebi', 'Tebi'),
    sevenrooms: readOnly('sevenrooms', 'SevenRooms'),
    guestplan: readOnly('guestplan', 'Guestplan'),
    zenchef: readOnly('zenchef', 'Zenchef'),
  };
}

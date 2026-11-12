// Which Role this device is currently viewing. Shared reactive state so the
// chart, the role switcher, and (later) the editor all agree. Anyone can switch
// Roles freely — no security. The playhead/sync is unaffected by the choice.

import { PROJECT } from './lib/model';
import type { Chart } from './lib/model';

export const view = $state<{ roleId: string }>({ roleId: PROJECT.roles[0].id });

export function currentChart(): Chart {
  return PROJECT.charts[view.roleId] ?? PROJECT.charts[PROJECT.roles[0].id];
}

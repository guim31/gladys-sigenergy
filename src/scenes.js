// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`). Both refuse while battery control
// is off in the configuration: a failed action is logged by the scene, which
// goes on.
//
// - set_battery_mode: the battery mode (automatic, forced charge or
//   discharge...), e.g. charge from the grid during off-peak hours.
// - set_battery_limits: the charge and/or discharge limit in watts, e.g. a
//   slow charge at night, or keep the battery for the evening.
//
// The scene triggers (alarm_raised, system_unreachable, system_reachable) are
// fired by the hub (src/hub.js).
// -----------------------------------------------------------------------------

import { setLimits, setMode } from './control.js';

export const SCENE_ACTION_KEYS = {
  SET_MODE: 'set_battery_mode',
  SET_LIMITS: 'set_battery_limits',
};

export const SCENE_ACTIONS = {
  [SCENE_ACTION_KEYS.SET_MODE]: async (hub, fields) => {
    const { mode } = await setMode(hub, fields.mode, 'scene');
    return { mode };
  },
  [SCENE_ACTION_KEYS.SET_LIMITS]: async (hub, fields) => {
    const { chargeW, dischargeW } = await setLimits(
      hub,
      { chargeW: fields.charge_limit_w, dischargeW: fields.discharge_limit_w },
      'scene',
    );
    const outputs = {};
    if (chargeW !== undefined) {
      outputs.charge_limit_w = chargeW;
    }
    if (dischargeW !== undefined) {
      outputs.discharge_limit_w = dischargeW;
    }
    return outputs;
  },
};

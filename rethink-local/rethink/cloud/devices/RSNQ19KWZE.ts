import RAC_056905_WW from './RAC_056905_WW'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'

/*
 * RSNQ19KWZE (LG cooling-only split AC, India) - maps to the ThinQ
 * RAC_056905_WW model family, but has no heat pump / IDU heater. The device
 * ACKs the heat mode write (TLV 0x1f9 = 4) yet never actually runs it, so
 * the HA climate entity must not offer heat (or the default heat_cool).
 * Verified live 2026-09-13: fan_only/cool/dry writes all ACK and function;
 * heat write ACKs but the unit stays idle.
 */
export default class Device extends RAC_056905_WW {
    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq, meta)
    }

    protected hvacModes(): string[] {
        return ['off', 'cool', 'dry', 'fan_only']
    }
}

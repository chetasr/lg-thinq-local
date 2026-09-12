# LG ThinQ local AC control — design

Date: 2026-09-12
Status: approved by user (in chat), pending spec review

## Problem

An LG wall-mounted air conditioner (model `RSNQ19KWZE.ANLG`, ThinQ app
"Device App" 5117.03, modem `clip_hna_v1.9.237_RT`, firmware
`SAA42760973.0000DF71.0`) is currently controlled through LG's ThinQ cloud
and phone app. The goal is fully local control: the AC must be monitorable
and controllable without any internet dependency, from Home Assistant.

## Decision: extend rethink, package as Home Assistant add-on

[rethink](https://github.com/anszom/rethink) (GPL) emulates the LG ThinQ
cloud for local networks: it provisions devices, impersonates the cloud
endpoints (TLS), hosts the private MQTT broker devices talk to, and
translates the device protocol (TLV-over-MQTT for ThinQ2 ACs) into
Home Assistant-compatible MQTT discovery entities.

`RSNQ19KWZE` is the same ThinQ2 "CLIP" modem family rethink already
supports (`bridge/thinq2connection.ts` reports itself to LG as
`clip_hna_v1.9.183`). The expected gap is a missing device class for the
RSNQ series' TLV schema, and possibly a newer setup/provisioning variant
(rethink issue #70: 2024-era firmware moved provisioning from
TLS/mtosp on port 5500 to plain HTTP on port 9000).

Community HA add-on packagings of rethink exist (e.g. `oirad/hassio-rethink`,
`The-sultan/hassio-rethink-addon`); rethink itself ships a Dockerfile.
Worst case we package our own add-on.

Rejected alternatives:

- Standalone from-scratch local server — re-derives provisioning, TLS,
  MQTT framing, and tooling rethink already solved; weeks of extra work,
  no functional gain.
- Hardware path (ESP32 wired-controller interception,
  `esphome-lg-controller`) — physical install, limited feature set; not
  chosen. If the software path fails, we stop and reevaluate together;
  there is **no preset hardware fallback**.

## End-state architecture

```
[LG AC RSNQ19KWZE]──home Wi-Fi──►[OpnSense / Unbound host overrides:
                                     eic.lgthinq.com, common.lgthinq.com
                                     → HA box IP]
                                        │
                                        ▼
[HA box] rethink-cloud add-on  ←──MQTT/TLS (device speaks "cloud" protocol)
   │            │
   │            └──HA MQTT discovery + state──►[Mosquitto]──►[HA]
   │
   └── management UI (port 44401, firewall-restricted)
```

- rethink-cloud impersonates the LG cloud for the AC: TLS certificate
  endpoint, provisioning, private MQTT broker.
- It translates the device's TLV packets into HA MQTT discovery entities.
- DNS hook: Unbound host overrides on OpnSense (custom router) map LG's
  endpoints to the HA box. Overrides are scoped so other LG devices, if
  any, keep using the real cloud.
- Bridge mode is off in the end state: device traffic never leaves the LAN.
- No separate hotspot/AP: the AC stays on home Wi-Fi; initial
  re-provisioning happens over the device's own SoftAP (`LGE_AC`) using
  rethink-setup (or the Android companion app).

### Accepted risk

The AC is currently provisioned to the official cloud on home Wi-Fi.
Re-provisioning it to rethink is required. rethink is designed so the
modem's settings remain recoverable (returning to the official cloud
should be possible), but there is a small, non-zero risk that returning
to stock becomes difficult. Accepted.

## Reverse-engineering workflow (RSNQ device class)

Following rethink's "Adding support for a new device" wiki playbook:

1. **Provision + bridge.** Re-provision the AC to rethink-cloud, then
   enable bridge mode for it: the AC transparently talks to the real LG
   cloud through rethink while every packet is logged, and the official
   app keeps working. Works before any device support exists.
2. **Capture ground truth.** `rethink-capture` records JSONL captures
   while the user exercises each feature from the phone/on the unit:
   power, target temp, mode, fan speed, swing, quiet/jet, timers.
   Each app action yields a command packet; each state change yields a
   status report.
3. **Cross-reference `modelJson`.** Fetch LG's published model metadata
   for the model via wideq (`modelJsonUrl` + language pack) to convert
   enum/range guessing into confirmation.
4. **Map state (device→cloud).** Diff TLV types against physical changes
   (baseline: DualCool `RAC_056905_WW` alphabet, e.g. `0x1f7` on/off,
   `0x1fe` target temp). `packet-parser` decodes live.
5. **Map commands (cloud→device).** Each app action → exact TLV write frame.
6. **Probe edge cases** via packet injection (management panel /
   `packet-sender`), cross-checking LG cloud interpretation with
   `lgcloud-monitor`.

Division of labor: the user drives the phone and the AC; the agent runs
tooling (including rethink's MCP server for decode/encode/probe), analyzes
captures, and writes code.

## Implementation

- New device class extending `TLVDevice` (base of `RAC_056905_WW.ts`):
  `addField()` maps TLV type IDs to HA properties with read/write
  transforms; the base class handles capability queries, periodic
  re-querying, command framing.
- Entities: HA climate entity (power, HVAC modes, target temp, fan modes,
  swing), sensors for room temp and energy if exposed. No timers/schedule
  logic in the device class (belongs in HA, per rethink guidelines).
- Tests: unit tests under `tests/cloud/devices/` mirroring existing ones;
  captured packets become fixtures; `npm test` must pass.
- Working copy: fork of rethink in this project directory; upstream
  `ghcr.io/anszom/rethink:dev` image is the fallback baseline.
- Stretch goal: upstream PR for the new device class.

## Packaging & rollout

1. HA add-on built from our fork's image, using an existing community
   add-on as packaging reference. Host networking for ports
   443/8883/44401; config options (MQTT URL, hostname, management port);
   Mosquitto as the HA broker.
2. Rollout: migrate data/config from the RE-phase instance to the add-on,
   flip Unbound overrides to the HA box, run ~a week in bridge mode
   (official app still works as a safety net), then switch the AC to
   pure-local (bridge off).
3. Done = AC fully controlled from HA with zero internet dependency.

## Feature scope

- Must: power on/off, target temp, operation mode (cool/dry/fan/heat/auto),
  room temp readout.
- Nice: fan speed, vertical/horizontal swing, jet mode, quiet mode.
- Bonus: energy monitoring, filter status, diagnostics.
- Unknown TLV types: ship must-haves first, log unknowns, add
  incrementally.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Provisioning protocol mismatch (issue #70, HTTP:9000) | Use documented Option C (official-app provisioning with `common.lgthinq.com` redirect enabled mid-flow); and/or fix rethink's setup path |
| Device rejects non-LG cloud at runtime | Detected in first bridge session; **stop and reevaluate together — no preset fallback** |
| Unknown TLV types for RSNQ features | Must-haves first; incremental additions |
| Modem reset/re-provisioning risk | Low per rethink design; accepted (see above) |

## Success criteria

1. AC re-provisioned to local rethink instance, visible in management panel.
2. TLV schema mapped for all must-have (and ideally nice-to-have) features,
   with unit-test fixtures.
3. Device class in rethink fork, `npm test` green.
4. HA add-on running on the HA box; AC entities discovered in Home
   Assistant.
5. Final state: bridge mode off, DNS overrides in place, AC controlled
   entirely locally with internet disconnected (verified).

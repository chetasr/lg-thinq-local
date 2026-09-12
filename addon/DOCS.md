# Rethink – LG ThinQ Local Server

Home Assistant add-on packaging [rethink](https://github.com/anszom/rethink)
— a fully local replacement for LG's ThinQ cloud, developed by reverse
engineering the ThinQ protocol.

Supported appliances see [rethink's README](https://github.com/anszom/rethink).
Your LG AC (`RSNQ19KWZE` family) reports model `RAC_056905_WW` and is
supported.

## Setup

1. **DNS override** (on your router, e.g. OpnSense with dnsmasq):
   point these names at the HA host IP, with a non-zero TTL:
   - `common.lgthinq.com` → HA IP
   - `eic.lgthinq.com` → HA IP
   - `rethink.lan` → HA IP (must match the `hostname` option)
2. **MQTT**: install/configure the Mosquitto broker add-on, create an HA user
   for rethink and fill `mqtt_user`/`mqtt_pass` options (or use
   `mqtt://homeassistant:1883` and no credentials if your broker allows the
   local network).
3. Start the add-on. Its management UI appears in the HA sidebar as
   **Rethink** (ingress) and on port `44401` on the host.
4. **Provision the appliance** (once): put the device in Wi-Fi setup mode and
   use [rethink-setup](https://github.com/anszom/rethink/wiki/SetupProtocol)
   from a Wi-Fi-capable device, or the Android companion app. The appliance
   then connects to this add-on instead of LG's cloud.
5. Home Assistant discovers the appliance over MQTT automatically.

## Notes

- The add-on binds ports 443, 8883, 1884, 46030, 47878 on the host
  (`host_network`). If another service on the HA host uses TLS MQTT on 8883
  (e.g. Mosquitto with TLS enabled), disable that listener or remap ports in
  `run.sh` — appliances re-provision on their next power cycle and pick up
  the new port.
- Appliances re-provision automatically after power cycles; no state
  migration is needed when moving rethink between hosts.
- Bridge mode (device traffic forwarded to the real LG cloud) can be enabled
  per device in the management UI; it is OFF by default.

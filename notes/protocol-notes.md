# RSNQ19KWZE protocol notes
## Device identity (from provisioning log)
- Device UUID: 07dd52b1-2b2c-1c79-bdb3-805b65cf1423
- ThinQ modelId: **RAC_056905_WW** (same as DualCool family!) · deviceType: 401 · platform: thinq2
- Provisioned 2026-09-12 via rethink-setup from laptop (SoftAP LGE_AC2_open, open network, device 192.168.120.254)
- Setup succeeded on the TLS/mtosp path (no issue #70 HTTP:9000 fallback needed)
- Device connects, is mapped:true by existing RAC_056905_WW class; publishes climate-mode/-temperatures/fan/swing/jet/autodry/energy_current/odu temps/fanrpm
- NOTE: user believed this AC unsupported — need to identify which features are actually missing/broken vs the DualCool class
### DNS setup (Task 3, done 2026-09-12)
- OpnSense dnsmasq Host Overrides: common.lgthinq.com, eic.lgthinq.com, rethink.lan → 10.10.1.75
- TTL observed = 1 s (non-zero, satisfies rethink wiki requirement; consider local-ttl=300 later)
- Laptop /etc/hosts pins real LG IPs (99.86.147.38 common, 52.158.31.24 eic, 52.79.59.188 route) so bridge egress bypasses overrides — verified: laptop reaches real cloud (HTTP/2 403), LAN resolves 10.10.1.75
- rethink.lan:443 serves rethink cert; mgmt UI http://rethink.lan:44401 → 200
### Infrastructure (RE phase)
- rethink-cloud: Docker `ghcr.io/anszom/rethink:dev`, host network, on laptop 10.10.1.75; data dir `~/lg-thinq-local/rethink-data`
- config: hostname `rethink.lan`, https 443, mqtts 8883, appliance mqtt 1884, management 44401 (HTTP, not HTTPS)
- AMENDMENT: rethink's :1884 is the appliance-side broker only; HA output goes to Mosquitto container on :1883 (`mqtt://localhost:1883`)
- CA key/cert generated 2026-09-12 in rethink-data/
## modelJson & language pack
## State mapping (device→cloud TLV)
## Command mapping (cloud→device TLV)
## Unknown TLV types (log for later)
## Open questions
- LG web login (lgemembers.com SSO, 2026-09-12): signInAct + checks return OK but final redirect to kr.m.lgaccount.com/login/iabClose?code=... never fires (both popup and full tab). Workaround: old-style login URL `https://in.m.lgaccount.com/login/sign_in?country=IN&language=en&svcCode=SVC202&authSvr=oauth2&client_id=LGAO221A02&division=ha&grant_type=password`, exchange code via rethink OAuth2.fromCode(authUrl=https://in.lgeapi.com), write rethink-data/state/oauth2.json. UPDATE 09:0x: old-style URL also stalls (LG-side, tried from 2 networks). Bridge login BLOCKED — proceed local-first, retry later.
- Gateway (IN): webUrl https://in.lgemembers.com/lgacc/service/v1/, authUrl https://in.lgeapi.com

## Local control verification (2026-09-12, no bridge/cloud, rethink MQTT only)
- All commands accepted by the AC via `rethink/<uuid>/<prop>/set`: temperature (24→25, 24→18), fan_mode (very high→low→very high), swing_mode (off→on→off, TLV 0x321=100), power (OFF→ON), mode (cool→dry→cool)
- Sensors flowing: current_temperature, energy_current, filterused/filterlife/filterchangeddate, oduhextemp, oduairtemp, fanrpm, capacity, eev, error, jet/autodry/sleeptimer
- RSNQ19KWZE maps to existing RAC_056905_WW class — full support, NO new device class needed
- WRITE PATH FULLY VERIFIED (after modem settled post-re-provision): temp 18 accepted (IDU ACK t=0x1fe=0x24, visible on display), 19 accepted (ACK pattern identical to remote-driven changes: single-TLV `000004000000870204xx` + full status block)
- Read path verified against remote-driven changes: IDU streams full status block per change + final single-TLV ACK
- Display light 0x21f: INVERTED on this unit (1=off, 0=on); not exposed as HA property by design; raw write via packet-sender (`543` = 0x21f, 2-byte TLV encoding `87c0`) toggled it successfully
- PITFALLS:
  - AC power-cycle → modem undeploy→redeploy cycle; recovers on its own after boot (~2 min)
  - Laptop DHCP lease changed (power cut) → overrides stale → device loses cloud path. FIX: static DHCP reservation for laptop MAC in OpnSense; keep all 3 overrides on the current IP
  - rethink mgmt UI is plain HTTP on :44401

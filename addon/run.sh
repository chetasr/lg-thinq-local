#!/bin/bash
set -e

OPTIONS="/data/options.json"
CONFIG="/data/config.json"

# /data is the persistent volume in HAOS: CA keypair, bridge state and the
# generated config all live here so they survive restarts.
mkdir -p /data/state

HOSTNAME=$(jq -r '.hostname' "$OPTIONS")
MQTT_URL=$(jq -r '.mqtt_url' "$OPTIONS")
MQTT_USER=$(jq -r '.mqtt_user // ""' "$OPTIONS")
MQTT_PASS=$(jq -r '.mqtt_pass // ""' "$OPTIONS")
MGMT_PORT=$(jq -r '.management_port // 44401' "$OPTIONS")

# Write config on every start so option changes are picked up.
cat > "$CONFIG" <<EOF
{
  "hostname": "${HOSTNAME}",
  "homeassistant": {
    "mqtt_url": "${MQTT_URL}",
    "discovery_prefix": "homeassistant",
    "rethink_prefix": "rethink",
    "mqtt_user": "${MQTT_USER}",
    "mqtt_pass": "${MQTT_PASS}"
  },
  "ca_key_file": "/data/ca.key",
  "ca_cert_file": "/data/ca.cert",
  "https_port": 443,
  "mqtts_port": 8883,
  "mqtt_port": 1884,
  "thinq1_https_port": 46030,
  "thinq1_port": 47878,
  "management_port": ${MGMT_PORT},
  "bridge": {
    "storage_path": "/data/state"
  },
  "log": ["status", "incoming", "HTTPS", "publish", "MGMT"]
}
EOF

echo "[rethink] starting, hostname=${HOSTNAME}, mqtt=${MQTT_URL}, mgmt=${MGMT_PORT}"
exec node /app/dist/rethink-cloud.js "$CONFIG"

FROM node:20-alpine

RUN apk add --no-cache openssl bash jq

# Vendor the (possibly patched) rethink source into the image.
COPY rethink /app
RUN cd /app && npm ci --ignore-scripts && npm run build

COPY run.sh /run.sh
RUN chmod +x /run.sh

ENTRYPOINT ["/run.sh"]

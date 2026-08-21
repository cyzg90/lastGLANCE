FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_WEBDAV_PROXY_URL=
ENV VITE_WEBDAV_PROXY_URL=${VITE_WEBDAV_PROXY_URL}
RUN npm run build

FROM nginx:alpine AS runtime
# Add Node.js for the WebDAV proxy sidecar
RUN apk add --no-cache nodejs

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Proxy sidecar — only needs package.json (for "type":"module") + the api handler
WORKDIR /app
COPY package.json ./
COPY api/ ./api/
COPY server.js ./

EXPOSE 80
CMD sh -c "node /app/server.js & nginx -g 'daemon off;'"

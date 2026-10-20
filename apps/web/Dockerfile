# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /workspace
ENV CI=true NX_DAEMON=false NX_NO_CLOUD=true
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate \
    && pnpm install --frozen-lockfile
COPY . .
RUN pnpm nx run web:build --configuration=production

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/dist/apps/web/browser/ /usr/share/nginx/html/
USER nginx
EXPOSE 8080

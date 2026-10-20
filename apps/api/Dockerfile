# syntax=docker/dockerfile:1
FROM node:24-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /workspace
ENV CI=true NX_DAEMON=false NX_NO_CLOUD=true
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate \
    && pnpm install --frozen-lockfile
COPY . .
RUN pnpm nx run api:prisma-generate \
    && pnpm nx run api:build --configuration=production

# Nx misses imports introduced by generated Prisma code and TypeScript helpers.
# Include those plus the migration CLI, using existing workspace versions only.
RUN node <<'NODE'
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { createProjectGraphAsync } = createRequire(require.resolve('@nx/js'))('@nx/devkit');
const { generatePrunedDeployOutput } = require('@nx/js');
(async () => {
  const root = require('./package.json');
  const path = 'dist/apps/api/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  pkg.dependencies.prisma = root.devDependencies.prisma;
  pkg.dependencies['@prisma/client'] = root.dependencies['@prisma/client'];
  pkg.dependencies.tslib = root.devDependencies.tslib;
  pkg.packageManager = root.packageManager;
  const graph = await createProjectGraphAsync();
  generatePrunedDeployOutput(pkg, graph, 'apps/api', {
    packageManager: 'pnpm',
    outputDirectory: 'dist/apps/api',
  });
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
})().catch((error) => { console.error(error); process.exit(1); });
NODE
RUN cd dist/apps/api \
    && PRISMA_SKIP_POSTINSTALL_GENERATE=true pnpm install --prod --frozen-lockfile

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PATH="/app/node_modules/.bin:${PATH}"
COPY --from=build --chown=node:node /workspace/dist/apps/api/ ./
COPY --from=build --chown=node:node /workspace/apps/api/prisma/ ./apps/api/prisma/
COPY --from=build --chown=node:node /workspace/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
USER node
EXPOSE 3000
CMD ["node", "main.js"]

# syntax=docker/dockerfile:1

FROM node:20.18.1-bookworm-slim AS build

WORKDIR /app

# Copy manifests first so dependency installation can be cached independently
# from source changes. The workspace manifests are required by npm ci.
COPY package.json package-lock.json ./
COPY packages ./packages

RUN npm ci

# Copy the remainder of the repository after dependencies are installed.
COPY . .
RUN npm run build

FROM node:20.18.1-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    CLIENT_PORT=5173

# Keep the installed workspace links and the built packages together. The
# root start script runs the production server and the built client preview.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

EXPOSE 3001
EXPOSE 5173

CMD ["npm", "run", "start"]

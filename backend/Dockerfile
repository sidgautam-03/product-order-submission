FROM node:22-slim

ENV NODE_ENV=development
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
# uploads and logs are written at runtime; the node user must own them (named volumes copy this ownership)
RUN mkdir -p uploads logs && chown -R node:node uploads logs

USER node
EXPOSE 5000
CMD ["node", "src/server.js"]

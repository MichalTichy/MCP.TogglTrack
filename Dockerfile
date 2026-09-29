FROM node:24-alpine

ENV NODE_ENV=production PORT=8080
WORKDIR /app

COPY package.json ./
COPY mcp ./mcp

USER node
EXPOSE 8080
CMD ["node", "mcp/http-server.mjs"]

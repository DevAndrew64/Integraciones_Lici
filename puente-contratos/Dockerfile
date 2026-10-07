FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PUENTE_HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 4010
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4010/health || exit 1
CMD ["node", "src/server.js"]

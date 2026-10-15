FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./server/package.json
RUN cd /app/server && npm install --omit=dev
COPY server ./server
COPY client ./client
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/server.mjs"]

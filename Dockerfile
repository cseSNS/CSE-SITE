FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json server.js ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public
RUN mkdir -p /app/public/vendor \
  && cp /app/node_modules/quill/dist/quill.js /app/public/vendor/quill.js \
  && cp /app/node_modules/quill/dist/quill.snow.css /app/public/vendor/quill.snow.css

RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

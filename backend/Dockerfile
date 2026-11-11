FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /app/.runtime && chown node:node /app/.runtime
COPY --chown=node:node . .
USER node
ENV HOST=0.0.0.0
EXPOSE 1880
CMD ["npm", "start"]

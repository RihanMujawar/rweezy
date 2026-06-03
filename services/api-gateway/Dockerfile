FROM node:20-slim
WORKDIR /app
COPY shared /app/shared
COPY services/api-gateway /app/services/api-gateway
WORKDIR /app/services/api-gateway
RUN npm install
EXPOSE 3000
CMD ["node", "index.js"]

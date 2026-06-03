FROM node:20-slim
WORKDIR /app
COPY shared /app/shared
COPY services/package-service /app/services/package-service
WORKDIR /app/services/package-service
RUN npm install
EXPOSE 3005
CMD ["node", "index.js"]

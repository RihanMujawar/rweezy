FROM node:20-slim
WORKDIR /app
COPY shared /app/shared
COPY services/notification-service /app/services/notification-service
WORKDIR /app/services/notification-service
RUN npm install
EXPOSE 3007
CMD ["node", "index.js"]

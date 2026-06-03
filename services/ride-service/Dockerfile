FROM node:20-slim
WORKDIR /app
COPY shared /app/shared
COPY services/ride-service /app/services/ride-service
WORKDIR /app/services/ride-service
RUN npm install
EXPOSE 3004
CMD ["node", "index.js"]

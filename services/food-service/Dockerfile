FROM node:20-slim
WORKDIR /app
COPY shared /app/shared
COPY services/food-service /app/services/food-service
WORKDIR /app/services/food-service
RUN npm install
EXPOSE 3002
CMD ["node", "index.js"]

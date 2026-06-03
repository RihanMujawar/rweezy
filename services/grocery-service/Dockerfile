FROM node:20-slim
WORKDIR /app
COPY shared /app/shared
COPY services/grocery-service /app/services/grocery-service
WORKDIR /app/services/grocery-service
RUN npm install
EXPOSE 3003
CMD ["node", "index.js"]

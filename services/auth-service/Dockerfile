FROM node:20-slim
WORKDIR /app
COPY shared /app/shared
COPY services/auth-service /app/services/auth-service
WORKDIR /app/services/auth-service
RUN npm install
EXPOSE 3001
CMD ["node", "index.js"]

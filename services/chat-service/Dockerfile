FROM node:20-slim
WORKDIR /app
COPY shared /app/shared
COPY services/chat-service /app/services/chat-service
WORKDIR /app/services/chat-service
RUN npm install
EXPOSE 3006
CMD ["node", "index.js"]

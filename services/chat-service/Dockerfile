FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY shared ./shared
COPY services/chat-service ./services/chat-service
RUN npm install
RUN npx prisma generate
WORKDIR /app/services/chat-service
EXPOSE 3006
CMD ["node", "index.js"]

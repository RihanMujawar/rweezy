FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY shared ./shared
COPY services/notification-service ./services/notification-service
RUN npm install
RUN npx prisma generate
WORKDIR /app/services/notification-service
CMD ["node", "index.js"]

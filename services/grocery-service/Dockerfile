FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY shared ./shared
COPY services/grocery-service ./services/grocery-service
RUN npm install
RUN npx prisma generate
WORKDIR /app/services/grocery-service
EXPOSE 3003
CMD ["node", "index.js"]

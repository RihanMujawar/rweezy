FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY shared ./shared
COPY services/food-service ./services/food-service
RUN npm install
RUN npx prisma generate
WORKDIR /app/services/food-service
EXPOSE 3002
CMD ["node", "index.js"]

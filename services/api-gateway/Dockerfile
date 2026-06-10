FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY shared ./shared
COPY services/api-gateway ./services/api-gateway
RUN npm install
RUN npx prisma generate
WORKDIR /app/services/api-gateway
EXPOSE 3000
CMD ["node", "index.js"]

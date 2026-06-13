FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY shared ./shared
COPY services/ride-service ./services/ride-service
RUN npm install
RUN npx prisma generate
WORKDIR /app/services/ride-service
EXPOSE 3004
CMD ["node", "index.js"]

FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
COPY shared ./shared
COPY services/auth-service ./services/auth-service
RUN npm install
RUN npx prisma generate
WORKDIR /app/services/auth-service
EXPOSE 3001
CMD ["node", "index.js"]

FROM node:18

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY . .

RUN npm install

CMD ["npx", "ts-node", "bot.ts"]
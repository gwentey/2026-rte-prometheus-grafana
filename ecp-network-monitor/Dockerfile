FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

CMD ["npx", "tsx", "server.ts"]

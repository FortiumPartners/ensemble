FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN node scripts/bundle.js
EXPOSE 8080
CMD ["node", "src/server.js"]

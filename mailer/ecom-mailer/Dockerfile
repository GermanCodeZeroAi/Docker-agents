FROM node:18-alpine

WORKDIR /app

COPY package.json index.js ./

RUN npm install --production

CMD ["node", "index.js"]

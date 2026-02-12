# syntax=docker/dockerfile:1

FROM node:20-alpine

# App fica em /app
WORKDIR /app

# Instala dependências (projeto só tem deps)
COPY package.json ./
RUN npm install --omit=dev

# Copia o código
COPY src ./src
COPY public ./public
COPY README.md ./

# Pasta de dados persistentes (tokens/state/etc)
RUN mkdir -p /data

# IMPORTANTe:
# o app grava tokens/state usando process.cwd()
# então rodamos com cwd = /data, mas executando o server em /app
WORKDIR /data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "/app/src/server.js"]

FROM node:20-bookworm-slim

WORKDIR /app

# Adiciona node_modules/.bin ao PATH
ENV PATH /app/node_modules/.bin:$PATH

# Instala dependências de sistema necessárias para Prisma e OpenSSL
RUN apt-get update && apt-get install -y \
    curl \
    openssl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copia pacotes e instala
COPY package*.json ./
RUN npm install --ignore-scripts

# Copia o código
COPY . .

# Gera o cliente Prisma
RUN node node_modules/prisma/build/index.js generate

# Expõe a porta
EXPOSE 3001

CMD ["node", "--expose-gc", "server.js"]

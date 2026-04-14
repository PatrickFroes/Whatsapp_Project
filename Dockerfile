FROM node:20-bookworm-slim

WORKDIR /app

# Instala dependências de sistema necessárias para Prisma e OpenSSL
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copia pacotes e instala
COPY package*.json ./
RUN npm install

# Copia o código
COPY . .

# Gera Prisma Client dentro da imagem (schema já copiado)
RUN npx prisma generate

# Expõe a porta
EXPOSE 3001

CMD ["node", "server.js"]

FROM node:22-alpine

WORKDIR /app

# Sem dependências (só módulos nativos do Node) — não precisa de npm install.
COPY . .

ENV PORT=8000
ENV DATA_DIR=/app/data

EXPOSE 8000

CMD ["node", "server.js"]

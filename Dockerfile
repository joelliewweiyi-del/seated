FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build
# The database lives in /app/var, apart from /app/data, which holds the bundled restaurant list.
ENV HOST=0.0.0.0 PORT=4310 SEATED_DB=/app/var/seated.db
VOLUME /app/var
EXPOSE 4310
CMD ["npx", "tsx", "src/server/main.ts"]

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
# 503 from /api/health means the radar stopped checking. Docker marks the container unhealthy.
HEALTHCHECK --interval=60s --timeout=10s --start-period=6m --retries=3   CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4310)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["npx", "tsx", "--disable-warning=ExperimentalWarning", "src/server/main.ts"]

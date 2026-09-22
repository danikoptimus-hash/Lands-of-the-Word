# Caddy с модулем ограничения запросов (github.com/mholt/caddy-ratelimit): в стандартном образе его нет,
# поэтому собираем свой образ в GitHub Actions и публикуем в ghcr.io (решение владельца 22.09, пункт 2).
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

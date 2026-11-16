#!/usr/bin/env bash
# Настройки базы (ревизия скорости, этап 2). Применяются командой ALTER SYSTEM и перечитываются без перезапуска базы;
# хранятся в томе базы (postgresql.auto.conf). Запуск: db-settings.sh <контейнер базы>. Повторный запуск ничего не меняет.
#
# Сервер: 1,9 ГБ памяти на пять контейнеров (игра, её база, стенд, база стенда, прокси), диск — SSD.
# - effective_cache_size — сколько памяти система отдаёт под кэш файлов: база охотнее пользуется индексами;
# - work_mem — память на одну сортировку (по умолчанию 4 МБ): рейтинги и «Аналитика» сортируют в памяти, а не на диске;
# - random_page_cost — на SSD чтение «вразброс» почти так же дёшево, как подряд (по умолчанию база считает диск медленным);
# - wal_compression — журнал изменений сжимается: меньше записи на диск;
# - log_min_duration_statement — запросы дольше 300 мс пишутся в журнал базы (docker logs <контейнер>);
#   log_parameter_max_length = 0 — без значений параметров: в них бывают тексты игроков.
set -euo pipefail
DB="${1:?контейнер базы}"
docker exec -i "$DB" psql -U lotw -d lotw -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER SYSTEM SET effective_cache_size = '512MB';
ALTER SYSTEM SET work_mem = '8MB';
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET wal_compression = on;
ALTER SYSTEM SET log_min_duration_statement = '300ms';
ALTER SYSTEM SET log_parameter_max_length = 0;
ALTER SYSTEM SET log_parameter_max_length_on_error = 0;
SELECT pg_reload_conf();
SQL
echo "настройки базы: $(docker exec "$DB" psql -U lotw -d lotw -tA -c "select string_agg(name || '=' || current_setting(name), ', ' order by name) from pg_settings where name in ('effective_cache_size','work_mem','random_page_cost','wal_compression','log_min_duration_statement')")"

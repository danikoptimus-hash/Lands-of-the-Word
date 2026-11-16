#!/bin/bash
# Время ответа запроса карты: 60 запросов подряд, медиана и 90-й процентиль. maptime.sh ПОРТ [заголовок] [запрос]
P=$1; H=$2; Q=$3; J=$(mktemp)
curl -s -c $J -H 'content-type: application/json' -d '{"nickname":"p4","password":"secret123"}' localhost:$P/api/auth/login -o /dev/null
U="localhost:$P/api/games/cmucujbgq0008s301ran0fnt4/my-map$Q"
for i in 1 2 3; do curl -s -b $J ${H:+-H "$H"} "$U" -o /dev/null; done
for i in $(seq 1 60); do curl -s -b $J ${H:+-H "$H"} "$U" -o /dev/null -w '%{time_total} %{size_download}\n'; done | sort -n | awk '{t[NR]=$1; s=$2} END {printf "медиана %.1f мс · p90 %.1f мс · ответ %d байт\n", t[int(NR/2)]*1000, t[int(NR*0.9)]*1000, s}'
rm -f $J

# Ролик «Осень» (08.11)

История партии «Осень» за 2:48: старт, дела, море, города, война, вызов столице «Небесного легиона», руины, итоги.
Озвучка — выбранный голос из «Моих голосов» ElevenLabs (`voice_id txnCCHHGKmYIwrn7HfHQ`, `eleven_v3`), текст и музыка —
`scripts/voice/lines-osen.json`, запуск — workflow `voice.yml` (ветка `voice-tts`).

Сборка (рабочая папка `R` вне репозитория: `R/tl`, `R/fw`, `R/fwz`, `R/audio`, `R/video` = эта папка):
1. Данные партии: `deploy/video-export.sh "Бич народов"` на сервере → дамп в локальную базу `lotw_osen`, сервер на :3001.
2. Кадры карты: `node capture-timelapse.mjs R/tl` (история ходов, каждый второй ход, без анимации — `reducedMotion`),
   салют: `node capture-fireworks.mjs R/fw2 110 night` и крупно `... R/fwz2 200 night 4 0.30 0.50` (часы браузера по 1/30 с).
   **Часы обязательно на паузе (`page.clock.pauseAt`)**: после `clock.install` время в браузере идёт само, и пока снимается кадр
   (секунды), салют улетает вперёд — в ролике он выходит ускоренным (ошибка 08.11, исправлена).
3. Звук: фразы из `voice-tts` → `R/audio/lines/sN.wav` (обрезка тишины) и `durations.txt`; `python3 timeline.py`; `python3 mix.py`.
4. `python3 prepare.py` (data.js), `node render.mjs preview 4,16` — проверочные кадры, `node render.mjs video 0 168 out.mp4` — видео,
   затем сведение с `R/mix.wav` через ffmpeg.
Сцены — `index.html`: тёмный фон, золотые заголовки Philosopher, медальоны испытаний, гербы команд, карта-карточка слева.

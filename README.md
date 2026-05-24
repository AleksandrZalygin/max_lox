# Система управления резервуаром с жидкостью (IoT)

Система автоматического контроля уровня жидкости и учёта расхода в прямоугольном баке. Работает на Raspberry Pi 4 с возможностью удалённого доступа через VPS.

---

## Архитектура

```
[Arduino Nano1 + ESP8266] ──WS──┐
                                 ├──► [Raspberry Pi 4: FastAPI + PostgreSQL]
[ESP-32S (нативный WiFi)] ──WS──┘          │                │
                                         Docker          Electron GUI
                                            │ (Raspberry инициирует)
                                        WS Bridge (каждые 2 сек)
                                            │
                                    [VPS: Traefik → Nginx]
                                            │            │
                                       FastAPI       React SPA
```

### Компоненты

| Узел | Роль |
|---|---|
| Arduino Nano #1 + ESP8266 | Управляет обоими насосами через реле; считывает датчик уровня HC-SR04 |
| ESP-32S | Считывает ёмкостный датчик влажности в трубке слива (встроенный WiFi + 12-бит АЦП) |
| Raspberry Pi 4 | FastAPI-сервер, PostgreSQL, полноэкранный GUI на Electron |
| VPS | TLS-прокси Traefik, Nginx, FastAPI-ретранслятор, React-приложение |

---

## Требования

- **Arduino Nano #1**: Arduino IDE 2.x, пакет плат `esp8266` (для ESP8266), библиотека `NewPing` (Tim Eckel), `ArduinoJson` v6
- **ESP-32S**: Arduino IDE 2.x, пакет плат `ESP32 by Espressif Systems` (через Board Manager), библиотека `arduinoWebSockets` (Markus Sattler), `ArduinoJson` v6
- **Raspberry Pi 4**: Docker + Docker Compose, Node.js 20+
- **VPS**: Docker + Docker Compose, доменное имя, направленное на IP VPS

---

## Быстрый старт

### 1. Прошивка Arduino

Отредактируйте `#define` в начале каждого `.ino`-файла:

```cpp
// arduino/nano1_pumps/nano1_pumps.ino  → прошивается на Arduino Nano #1
// arduino/esp32_moisture/esp32_moisture.ino → прошивается на ESP-32S
#define WIFI_SSID      "НазваниеСети"
#define WIFI_PASS      "Пароль"
#define SERVER_HOST    "192.168.1.100"   // статический IP Raspberry Pi
#define SERVER_PORT    8000
#define STATION_ID     "station_001"
```

Оба устройства используют одинаковый `STATION_ID`. Подробности прошивки — в `ЗАПУСК.md`.

### 2. Raspberry Pi

```bash
cd raspberry

# Создать файл переменных окружения
cat > .env <<EOF
DATABASE_URL=postgresql+asyncpg://water:secret@db:5432/waterdb
VPS_WS_URL=wss://yourdomain.com/ws/raspberry
VPS_API_KEY=замените-на-длинный-случайный-секрет
STATION_ID=station_001
POSTGRES_DB=waterdb
POSTGRES_USER=water
POSTGRES_PASSWORD=secret
EOF

docker compose up -d
```

API доступен по адресу `http://192.168.1.100:8000`.

Создать первую станцию:

```bash
curl -X POST http://192.168.1.100:8000/api/stations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Основной бак",
    "description": "Садовый резервуар",
    "calibration": {
      "distance_empty": 50.0,
      "distance_full": 5.0,
      "length_cm": 100.0,
      "width_cm": 60.0,
      "height_cm": 45.0
    }
  }'
```

### 3. Запуск Electron GUI

```bash
cd raspberry/electron-ui
npm install
npm run dev
```

### 4. Деплой VPS

```bash
cd vps

# Обязательно: установить права на файл SSL (Traefik не запустится без этого)
chmod 600 traefik/acme.json

# Создать файл переменных окружения
cat > .env <<EOF
API_KEY=замените-на-длинный-случайный-секрет    # совпадает с Raspberry VPS_API_KEY
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=\$2b\$12\$...               # bcrypt-хэш пароля, см. ниже
JWT_SECRET=другой-длинный-случайный-секрет
RASPBERRY_API_URL=http://192.168.1.100:8000
EOF

# Сгенерировать bcrypt-хэш пароля
python3 -c "from passlib.hash import bcrypt; print(bcrypt.hash('ваш_пароль'))"

# Отредактировать vps/traefik/traefik.yml: вставить свой email вместо admin@yourdomain.com
# Отредактировать vps/docker-compose.yml: вставить свой домен вместо yourdomain.com

docker compose up -d
```

Веб-интерфейс доступен по адресу `https://yourdomain.com`.

---

## Калибровка

### Датчик уровня (HC-SR04)

Формула расчёта уровня:
```
level_pct = (distance_empty - текущее_расстояние) / (distance_empty - distance_full) × 100
volume_l  = length_cm × width_cm × (height_cm × level_pct / 100) / 1000
```

Порядок калибровки:
1. Полностью опустошить бак
2. Зафиксировать показание датчика — это `distance_empty`
3. Наполнить бак до максимально допустимого уровня
4. Зафиксировать показание датчика — это `distance_full`
5. Измерить внутренние габариты бака (`length_cm`, `width_cm`, `height_cm`)
6. Ввести значения через экран калибровки в Electron UI или через API:

```bash
curl -X PATCH http://192.168.1.100:8000/api/stations/{station_id} \
  -H "Content-Type: application/json" \
  -d '{
    "calibration": {
      "distance_empty": 50.0,
      "distance_full": 5.0,
      "length_cm": 100.0,
      "width_cm": 60.0,
      "height_cm": 45.0
    }
  }'
```

### Калибровка датчика влажности

Отредактировать `DRY_VALUE` и `WET_VALUE` в `esp32_moisture.ino`:
- Открыть Serial Monitor Arduino IDE (**115200 бод**)
- Держать датчик в воздухе → записать raw в строке `[STATS]` → это `DRY_VALUE` (~2800)
- Опустить датчик в воду → записать raw → это `WET_VALUE` (~1400)
- Значения 12-бит АЦП (диапазон 0–4095), в 4 раза больше чем у 10-бит Arduino

---

## Справочник API

Базовый URL (Raspberry): `http://192.168.1.100:8000`
Базовый URL (VPS): `https://yourdomain.com`

### Станции

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/stations` | Список всех станций с текущим состоянием |
| `POST` | `/api/stations` | Создать станцию |
| `GET` | `/api/stations/{id}` | Получить данные станции |
| `PATCH` | `/api/stations/{id}` | Обновить название, описание или калибровку |
| `DELETE` | `/api/stations/{id}` | Удалить станцию |

### Команды управления

| Метод | Путь | Тело | Описание |
|---|---|---|---|
| `POST` | `/api/stations/{id}/pumps` | `{"action": "on"\|"off"}` | Включить/выключить насосы. Возвращает 409 если уровень ≥ 100% и action = "on" |
| `POST` | `/api/stations/{id}/mode` | `{"mode": "auto"\|"manual", "target_level": 80}` | Установить режим работы |

### Данные

| Метод | Путь | Параметры | Описание |
|---|---|---|---|
| `GET` | `/api/stations/{id}/measurements` | `from`, `to` (ISO8601), `limit` (макс. 1000) | История измерений (хранится 7 дней) |
| `GET` | `/api/stations/{id}/events` | `limit`, `type` | Журнал событий |

### Авторизация (VPS)

| Метод | Путь | Тело | Описание |
|---|---|---|---|
| `POST` | `/auth/login` | `{"username": "...", "password": "..."}` | Возвращает JWT-токен |
| `GET` | `/auth/me` | — | Проверить токен, вернуть информацию о пользователе |

---

## Протокол WebSocket

### Arduino → Raspberry (`/ws/arduino`)

```json
// Arduino Nano #1 (насосы + уровень)
{
  "type": "sensor_data",
  "device": "nano1",
  "station_id": "station_001",
  "distance_cm": 23.5,
  "pumps": false
}

// ESP-32S (поток в трубке слива) — 12-бит АЦП, raw до 4095
{
  "type": "sensor_data",
  "device": "esp32",
  "station_id": "station_001",
  "moisture_raw": 1950,
  "moisture_pct": 60
}
```

### Raspberry → Arduino

```json
{ "type": "command", "action": "pumps_on" }
{ "type": "command", "action": "pumps_off" }
```

Насосы **всегда** включаются и выключаются вместе — никогда по отдельности.

### Raspberry → VPS (`/ws/raspberry`, каждые 2 секунды)

```json
{
  "type": "state_update",
  "station_id": "station_001",
  "level_pct": 45.2,
  "volume_l": 12.3,
  "moisture_pct": 58.0,
  "pumps": false,
  "mode": "manual"
}
```

### VPS → Raspberry (команды от веб-пользователя)

```json
{ "type": "command", "station_id": "station_001", "action": "pumps_on" }
{ "type": "command", "station_id": "station_001", "action": "pumps_off" }
{ "type": "command", "station_id": "station_001", "action": "set_auto_mode", "target_level": 80 }
{ "type": "command", "station_id": "station_001", "action": "set_manual_mode" }
```

---

## Переменные окружения

### Raspberry `.env`

| Переменная | Описание |
|---|---|
| `DATABASE_URL` | Строка подключения к PostgreSQL (`postgresql+asyncpg://...`) |
| `VPS_WS_URL` | WebSocket URL VPS (`wss://yourdomain.com/ws/raspberry`) |
| `VPS_API_KEY` | Общий секрет для аутентификации Raspberry ↔ VPS |
| `STATION_ID` | ID станции по умолчанию (должен совпадать с `#define STATION_ID` в Arduino) |
| `POSTGRES_DB` | Имя базы данных PostgreSQL |
| `POSTGRES_USER` | Пользователь PostgreSQL |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL |

### VPS `.env`

| Переменная | Описание |
|---|---|
| `API_KEY` | Общий секрет (совпадает с `VPS_API_KEY` на Raspberry) |
| `ADMIN_USERNAME` | Логин для входа в веб-интерфейс |
| `ADMIN_PASSWORD_HASH` | bcrypt-хэш пароля веб-интерфейса |
| `JWT_SECRET` | Секрет для подписи JWT-токенов |
| `RASPBERRY_API_URL` | Базовый URL API Raspberry для проксирования исторических данных |

---

## Бизнес-логика

### Обнаружение протечки

Протечка фиксируется при одновременном выполнении всех условий:
- Уровень **падает** быстрее 0.05%/сек (среднее за 30 секунд)
- Датчик влажности показывает **менее 30%** (воды в трубке нет)
- Насосы **выключены**

При обнаружении: событие записывается в БД, в Electron UI появляется баннер-предупреждение, клиенты VPS получают уведомление.

### Авторежим

- Пользователь задаёт целевой уровень (например, 80%)
- Гистерезис ±5%: насосы включаются при уровне <75%, выключаются при >85%
- Автоматическая остановка при 100% в любом режиме
- В UI отображается: «Авторежим: 80%»

### Учёт расхода

Если датчик влажности показывает >30% И уровень падает И насосы выключены — зафиксирован нормальный слив. Расход = `объём_в_начале_слива − текущий_объём`.

---

## Структура проекта

```
/
├── schemas.md              Схемы подключения железа
├── README.md               Этот файл
├── ЗАПУСК.md               Пошаговое руководство по запуску
├── arduino/
│   ├── nano1_pumps/        C++ — насосы + HC-SR04 + WebSocket (Arduino Nano + ESP8266)
│   └── esp32_moisture/     C++ — датчик влажности + WebSocket (ESP-32S, нативный WiFi)
├── raspberry/
│   ├── docker-compose.yml
│   └── api/                FastAPI + PostgreSQL
│       ├── main.py
│       ├── routers/
│       ├── services/
│       ├── models/
│       └── requirements.txt
│   └── electron-ui/        Electron + React + TypeScript
├── vps/
│   ├── docker-compose.yml
│   ├── traefik/
│   ├── nginx/
│   ├── api/                FastAPI-ретранслятор (без БД)
│   └── web/                React + Vite + TypeScript
```

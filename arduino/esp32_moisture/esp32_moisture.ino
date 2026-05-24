/*
  ESP-32S — Ёмкостный датчик влажности (определение потока в трубке слива)
  Нативный WiFi + WebSocket без AT-команд и SoftwareSerial.

  Подключение:
    GPIO34 ← Датчик влажности AOUT  (input-only пин, идеален для АЦП)
    3.3V   → Датчик влажности VCC
    GND    → Датчик влажности GND

  Требуемые библиотеки (Arduino IDE):
    - Плата: "ESP32 by Espressif Systems" через Board Manager
      URL: https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
    - arduinoWebSockets by Markus Sattler  (Library Manager)
    - ArduinoJson v6                        (Library Manager)

  Калибровка (12-бит АЦП, диапазон 0–4095):
    DRY_VALUE — показание в сухом воздухе
    WET_VALUE — показание при полном погружении в воду
    Запустите Serial Monitor, поднесите датчик к сухому трубопроводу и
    запишите значение; затем к мокрому — запишите второе.
*/

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ── Конфигурация ──────────────────────────────────────────────────────────────
#define WIFI_SSID      "Sting's Galaxy S22 Ultra"
#define WIFI_PASS      "123456789"
#define SERVER_HOST    "10.165.149.244"
#define SERVER_PORT    8000
#define WS_PATH        "/ws/arduino"
#define STATION_ID     "station_001"

// Калибровка 12-бит АЦП (0–4095).
// Скорректируйте под ваш датчик: по умолчанию типичные значения.
#define DRY_VALUE         800
#define WET_VALUE         600
#define ANOMALY_THRESHOLD  400   // скачок > порога → предупреждение в лог

// ── Пины ─────────────────────────────────────────────────────────────────────
#define MOISTURE_PIN  34   // GPIO34: input-only, нет риска конфликта с выходом
#define SAMPLE_COUNT  10

// ── Интервалы ────────────────────────────────────────────────────────────────
#define SENSOR_INTERVAL_MS  1000
#define STATS_INTERVAL_MS  60000

// ── Логирование (Serial.printf — нет нужды в F()-макросе на ESP32) ───────────
#define LOG_INFO(msg)         Serial.printf("[%lu] [ESP32] [INFO]  " msg "\n", millis())
#define LOG_ERROR(msg)        Serial.printf("[%lu] [ESP32] [ERROR] " msg "\n", millis())
#define LOG_DEBUG(msg)        Serial.printf("[%lu] [ESP32] [DEBUG] " msg "\n", millis())
#define LOG_WARN(msg)         Serial.printf("[%lu] [ESP32] [WARN]  " msg "\n", millis())
#define LOG_INFO_F(fmt, ...)  Serial.printf("[%lu] [ESP32] [INFO]  " fmt "\n", millis(), ##__VA_ARGS__)
#define LOG_ERROR_F(fmt, ...) Serial.printf("[%lu] [ESP32] [ERROR] " fmt "\n", millis(), ##__VA_ARGS__)
#define LOG_DEBUG_F(fmt, ...) Serial.printf("[%lu] [ESP32] [DEBUG] " fmt "\n", millis(), ##__VA_ARGS__)
#define LOG_WARN_F(fmt, ...)  Serial.printf("[%lu] [ESP32] [WARN]  " fmt "\n", millis(), ##__VA_ARGS__)

// ── Глобальное состояние ─────────────────────────────────────────────────────
WebSocketsClient webSocket;

bool     wsConnected  = false;
uint32_t reconnectCount = 0;
uint32_t messagesSent   = 0;
int      lastRawValue   = -1;

unsigned long lastSensorSend = 0;
unsigned long lastStatsPrint = 0;

// ── WebSocket-обработчик событий ─────────────────────────────────────────────
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      wsConnected = false;
      LOG_WARN("WebSocket отключён — библиотека переподключится автоматически");
      break;

    case WStype_CONNECTED:
      wsConnected = true;
      reconnectCount++;
      LOG_INFO_F("WebSocket подключён (всего соединений: %u)", reconnectCount);
      break;

    case WStype_TEXT:
      // ESP-32S не принимает команды — логируем неожиданные сообщения
      LOG_WARN_F(
        "Неожиданное WS-сообщение (len=%u): %.*s",
        (unsigned)length, (int)length, (char*)payload
      );
      break;

    case WStype_ERROR:
      wsConnected = false;
      LOG_ERROR("WebSocket: ошибка библиотеки");
      break;

    case WStype_PING:
      LOG_DEBUG("WebSocket PING получен");
      break;

    case WStype_PONG:
      LOG_DEBUG("WebSocket PONG получен");
      break;

    default:
      break;
  }
}

// ── Подключение к WiFi ───────────────────────────────────────────────────────
void connectWiFi() {
  LOG_INFO_F("Подключение к WiFi: %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    if (millis() - start > 15000) {
      LOG_ERROR("Таймаут подключения к WiFi (15 с) — перезагрузка");
      ESP.restart();
    }
  }

  LOG_INFO_F(
    "WiFi подключён!  IP: %s  RSSI: %d дБм",
    WiFi.localIP().toString().c_str(), WiFi.RSSI()
  );
}

// ── Медианный фильтр для ADC ─────────────────────────────────────────────────
int readMoistureRaw() {
  int samples[SAMPLE_COUNT];
  for (int i = 0; i < SAMPLE_COUNT; i++) {
    samples[i] = analogRead(MOISTURE_PIN);
    delay(5);
  }

  // Сортировка вставками
  for (int i = 1; i < SAMPLE_COUNT; i++) {
    int key = samples[i];
    int j   = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }
  int median = samples[SAMPLE_COUNT / 2];

  if (lastRawValue >= 0 && abs(median - lastRawValue) > ANOMALY_THRESHOLD) {
    LOG_WARN_F(
      "Аномалия датчика: raw прыгнул с %d до %d",
      lastRawValue, median
    );
  }
  lastRawValue = median;
  return median;
}

// ── Отправка данных датчика ──────────────────────────────────────────────────
void sendSensorData() {
  int raw = readMoistureRaw();
  int pct = constrain(map(raw, DRY_VALUE, WET_VALUE, 0, 100), 0, 100);

  if (raw > DRY_VALUE + 100) {
    LOG_ERROR_F(
      "raw=%d выше DRY_VALUE+100 — датчик возможно не подключён", raw
    );
  } else if (raw < WET_VALUE - 100) {
    LOG_WARN_F(
      "raw=%d ниже WET_VALUE-100 — полностью мокрый или нужна калибровка", raw
    );
  }

  StaticJsonDocument<160> doc;
  doc["type"]         = "sensor_data";
  doc["device"]       = "esp32";          // идентификатор устройства
  doc["station_id"]   = STATION_ID;
  doc["moisture_raw"] = raw;
  doc["moisture_pct"] = pct;

  String payload;
  serializeJson(doc, payload);

  LOG_DEBUG_F("Отправка: %s", payload.c_str());
  webSocket.sendTXT(payload);
  messagesSent++;
}

// ── Статистика ────────────────────────────────────────────────────────────────
void printStats() {
  Serial.printf(
    "[%lu] [ESP32] [STATS] ── Статистика ──────────────────────\n", millis()
  );
  Serial.printf("[ESP32] [STATS]   Uptime (мс):        %lu\n",  millis());
  Serial.printf("[ESP32] [STATS]   WS-соединений:      %u\n",   reconnectCount);
  Serial.printf("[ESP32] [STATS]   Отправлено сообщ.:  %u\n",   messagesSent);
  Serial.printf("[ESP32] [STATS]   WS подключён:       %s\n",   wsConnected ? "ДА" : "НЕТ");
  Serial.printf("[ESP32] [STATS]   Последний raw:      %d\n",   lastRawValue);
  Serial.printf("[ESP32] [STATS]   DRY_VALUE:          %d\n",   DRY_VALUE);
  Serial.printf("[ESP32] [STATS]   WET_VALUE:          %d\n",   WET_VALUE);
  Serial.printf("[ESP32] [STATS]   Свободная heap:     %u байт\n", ESP.getFreeHeap());
  Serial.printf("[ESP32] [STATS]   WiFi RSSI:          %d дБм\n", WiFi.RSSI());
  Serial.printf("[ESP32] [STATS]   IP-адрес:           %s\n",
                WiFi.localIP().toString().c_str());
  Serial.println("[ESP32] [STATS] ─────────────────────────────────────────");
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println();

  LOG_INFO("=== ESP-32S Датчик влажности (детектор потока) стартует ===");
  LOG_INFO_F("Station ID:  %s", STATION_ID);
  LOG_INFO_F("Сервер:      %s:%d%s", SERVER_HOST, SERVER_PORT, WS_PATH);
  LOG_INFO_F("DRY_VALUE:   %d  (12-бит АЦП, диапазон 0–4095)", DRY_VALUE);
  LOG_INFO_F("WET_VALUE:   %d", WET_VALUE);

  // АЦП: максимальное затухание → диапазон измерения 0–3.3В
  analogSetAttenuation(ADC_11db);
  LOG_INFO_F("АЦП: GPIO%d, 12-бит, затухание 11 дБ (0–3.3В)", MOISTURE_PIN);

  connectWiFi();

  // Настройка WebSocket-клиента — библиотека управляет переподключением сама
  webSocket.begin(SERVER_HOST, SERVER_PORT, WS_PATH);
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000);
  // Heartbeat: ping каждые 15 с, таймаут pong 3 с, 2 пропуска → отключение
  webSocket.enableHeartbeat(15000, 3000, 2);

  LOG_INFO("WebSocket-клиент запущен — ожидаю подключения...");
  LOG_INFO("=== Setup завершён ===");
}

// ── Основной цикл ─────────────────────────────────────────────────────────────
void loop() {
  // Обязательный вызов каждую итерацию — библиотека обслуживает WS-соединение
  webSocket.loop();

  // Проверка WiFi: пытаемся восстановить если сеть упала
  if (WiFi.status() != WL_CONNECTED) {
    LOG_ERROR("WiFi потерян — попытка восстановления...");
    WiFi.reconnect();
    delay(1000);
    return;
  }

  unsigned long now = millis();

  if (wsConnected && (now - lastSensorSend >= SENSOR_INTERVAL_MS)) {
    lastSensorSend = now;
    sendSensorData();
  }

  if (now - lastStatsPrint >= STATS_INTERVAL_MS) {
    lastStatsPrint = now;
    printStats();
  }
}

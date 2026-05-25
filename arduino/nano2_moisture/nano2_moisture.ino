/*
  Arduino Nano #2 — Moisture sensor (YL-69 + LM393)
  Reads sensor from A0, sends JSON line to ESP8266 via SoftwareSerial.
  ESP8266 handles all WiFi and WebSocket logic (see esp8266_wifi/esp8266_wifi.ino).

  Wiring:
    Nano GND ↔ ESP GND
    Nano D3  → ESP D5  (SoftwareSerial TX → ESP RX, sends JSON)
    Nano D2  ← ESP D6  (SoftwareSerial RX ← ESP TX, not used)
    Nano A0  ← LM393 AO
    Nano 5V  → LM393 VCC
    Nano GND → LM393 GND
    LM393 board → YL-69 probe

  Libraries required:
    - ArduinoJson v6  (Library Manager)
    SoftwareSerial is part of Arduino AVR core.

  Calibration (10-bit ADC, 0–1023):
    DRY_VALUE — probe in dry air (~700–900)
    WET_VALUE — probe in water (~200–400)
    Open Serial Monitor at 9600 baud, measure both, update and reflash.
*/

#include <SoftwareSerial.h>
#include <ArduinoJson.h>

// ── Configuration ──────────────────────────────────────────────────────────
#define STATION_ID  "station_001"
#define DRY_VALUE   800
#define WET_VALUE   300

// ── Pins ───────────────────────────────────────────────────────────────────
#define ESP_RX        2   // not used for sending, but SoftwareSerial needs both
#define ESP_TX        3   // → ESP D5 (ESP RX)
#define MOISTURE_PIN  A0
#define SAMPLE_COUNT  10

// ── Timing ─────────────────────────────────────────────────────────────────
#define SEND_INTERVAL_MS  1000

// ── Globals ────────────────────────────────────────────────────────────────
SoftwareSerial espSerial(ESP_RX, ESP_TX);
unsigned long lastSend = 0;
uint32_t sendCount = 0;
String statusBuffer = "";  // accumulates STATUS: lines from ESP8266

// ── Median filter (removes noise from resistive sensor) ───────────────────
int readMoistureRaw() {
  int s[SAMPLE_COUNT];
  for (int i = 0; i < SAMPLE_COUNT; i++) {
    s[i] = analogRead(MOISTURE_PIN);
    delay(5);
  }
  for (int i = 1; i < SAMPLE_COUNT; i++) {
    int key = s[i], j = i - 1;
    while (j >= 0 && s[j] > key) { s[j + 1] = s[j]; j--; }
    s[j + 1] = key;
  }
  return s[SAMPLE_COUNT / 2];
}

// ── Send JSON line to ESP8266 ─────────────────────────────────────────────
void sendData() {
  int raw = readMoistureRaw();
  int pct = constrain(map(raw, DRY_VALUE, WET_VALUE, 0, 100), 0, 100);

  StaticJsonDocument<128> doc;
  doc["type"]         = "sensor_data";
  doc["device"]       = "esp32";      // keep for Raspberry backend compatibility
  doc["station_id"]   = STATION_ID;
  doc["moisture_raw"] = raw;
  doc["moisture_pct"] = pct;

  String line;
  serializeJson(doc, line);

  espSerial.println(line);   // ESP reads until '\n'
  sendCount++;

  Serial.print(F("[NANO2] TX #"));
  Serial.print(sendCount);
  Serial.print(F(" raw="));
  Serial.print(raw);
  Serial.print(F(" pct="));
  Serial.print(pct);
  Serial.println(F("%"));

  if (raw > DRY_VALUE + 50) {
    Serial.println(F("[NANO2] WARNING: raw above DRY_VALUE — probe may be disconnected"));
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(9600);
  espSerial.begin(9600);
  delay(100);

  Serial.println(F("[NANO2] === Arduino Nano #2 (YL-69/LM393 moisture) starting ==="));
  Serial.print(F("[NANO2] DRY_VALUE=")); Serial.print(DRY_VALUE);
  Serial.print(F("  WET_VALUE=")); Serial.println(WET_VALUE);
  Serial.println(F("[NANO2] Sending JSON to ESP8266 every 1s"));
}

// ── Read status lines from ESP8266 ────────────────────────────────────────
void readEspStatus() {
  while (espSerial.available()) {
    char c = espSerial.read();
    if (c == '\n') {
      statusBuffer.trim();
      if (statusBuffer.startsWith("STATUS:")) {
        String s = statusBuffer.substring(7);  // strip "STATUS:"
        Serial.print(F("[NANO2] [ESP] "));
        if      (s == "WIFI_CONNECTING")  Serial.println(F("WiFi connecting..."));
        else if (s == "WIFI_CONNECTED")   Serial.println(F("WiFi CONNECTED"));
        else if (s == "WIFI_LOST")        Serial.println(F("WiFi LOST"));
        else if (s == "WIFI_TIMEOUT")     Serial.println(F("WiFi TIMEOUT — ESP restarting"));
        else if (s == "WS_CONNECTED")     Serial.println(F("WebSocket CONNECTED to Raspberry"));
        else if (s == "WS_DISCONNECTED")  Serial.println(F("WebSocket DISCONNECTED"));
        else if (s == "WS_ERROR")         Serial.println(F("WebSocket ERROR"));
        else { Serial.print(F("? ")); Serial.println(s); }
      }
      statusBuffer = "";
    } else {
      statusBuffer += c;
      if (statusBuffer.length() > 64) statusBuffer = "";  // guard against garbage
    }
  }
}

// ── Loop ───────────────────────────────────────────────────────────────────
void loop() {
  readEspStatus();  // check for status messages from ESP8266

  unsigned long now = millis();
  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;
    sendData();
  }
}
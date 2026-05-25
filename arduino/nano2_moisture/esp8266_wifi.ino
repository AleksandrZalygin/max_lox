/*
  ESP8266MOD — WiFi + WebSocket bridge for Arduino Nano #2 (moisture sensor)

  Receives JSON lines from Arduino Nano via SoftwareSerial,
  forwards them to Raspberry Pi WebSocket.

  Wiring (ESP8266MOD side):
    D5 (GPIO14) ← Nano D3 (SoftwareSerial TX from Nano)
    D6 (GPIO12) → Nano D2 (SoftwareSerial RX on Nano, optional ACK)
    GND         ↔ Nano GND

  Flash settings in Arduino IDE:
    Board:       Generic ESP8266 Module  (or NodeMCU 1.0)
    Upload Speed: 115200
    CPU Freq:    80 MHz
    Flash Size:  4MB (FS: 1MB)

  Libraries required (Library Manager):
    - arduinoWebSockets by Markus Sattler
    - ArduinoJson v6
    ESP8266WiFi is part of the ESP8266 board package — no install needed.
*/

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <SoftwareSerial.h>

// ── Configuration ──────────────────────────────────────────────────────────
#define WIFI_SSID    "Sting's Galaxy S22 Ultra"
#define WIFI_PASS    "123456789"
#define SERVER_HOST  "10.165.149.244"
#define SERVER_PORT  8000
#define WS_PATH      "/ws/arduino"

// ── Serial link with Arduino Nano ──────────────────────────────────────────
// D5=GPIO14 = RX (receives JSON from Nano D3)
// D6=GPIO12 = TX (sends status strings to Nano D2)
SoftwareSerial nanoSerial(D5, D6);
#define NANO_BAUD 9600

// ── Globals ─────────────────────────────────────────────────────────────────
WebSocketsClient ws;
bool wsConnected  = false;
bool wifiOk       = false;
uint32_t fwdCount = 0;
uint32_t errCount = 0;
String lineBuffer = "";

// Send a short status line to Arduino Nano (visible in Nano's Serial Monitor)
void notifyNano(const char* status) {
  nanoSerial.print("STATUS:");
  nanoSerial.println(status);
}

// ── WebSocket event handler ──────────────────────────────────────────────────
void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.printf("[%lu] [ESP-BRIDGE] WS connected to %s:%d\n",
                    millis(), SERVER_HOST, SERVER_PORT);
      notifyNano("WS_CONNECTED");
      break;
    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.printf("[%lu] [ESP-BRIDGE] WS disconnected — reconnecting...\n", millis());
      notifyNano("WS_DISCONNECTED");
      break;
    case WStype_ERROR:
      wsConnected = false;
      Serial.printf("[%lu] [ESP-BRIDGE] WS error\n", millis());
      notifyNano("WS_ERROR");
      break;
    default:
      break;
  }
}

// ── WiFi connection ───────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("[%lu] [ESP-BRIDGE] Connecting to WiFi: %s\n", millis(), WIFI_SSID);
  notifyNano("WIFI_CONNECTING");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (millis() - start > 15000) {
      Serial.println();
      Serial.printf("[%lu] [ESP-BRIDGE] WiFi timeout — restarting\n", millis());
      notifyNano("WIFI_TIMEOUT");
      delay(100);
      ESP.restart();
    }
  }
  Serial.println();
  Serial.printf("[%lu] [ESP-BRIDGE] WiFi connected. IP: %s  RSSI: %d dBm\n",
                millis(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
  wifiOk = true;
  notifyNano("WIFI_CONNECTED");
}

// ── Forward JSON line to WebSocket ────────────────────────────────────────────
void forwardToWs(const String& json) {
  StaticJsonDocument<192> doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    errCount++;
    Serial.printf("[%lu] [ESP-BRIDGE] JSON parse error: %s — raw: %s\n",
                  millis(), err.c_str(), json.c_str());
    return;
  }

  // Ensure 'type' field is present (Raspberry expects it)
  if (!doc.containsKey("type")) {
    doc["type"] = "sensor_data";
  }

  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
  fwdCount++;
  Serial.printf("[%lu] [ESP-BRIDGE] Forwarded (#%u): %s\n", millis(), fwdCount, out.c_str());
}

// ── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println();
  Serial.printf("[%lu] [ESP-BRIDGE] === ESP8266 Nano2 bridge starting ===\n", millis());

  nanoSerial.begin(NANO_BAUD);
  Serial.printf("[%lu] [ESP-BRIDGE] SoftwareSerial ready at %d baud (D5=RX, D6=TX)\n",
                millis(), NANO_BAUD);

  connectWiFi();

  ws.begin(SERVER_HOST, SERVER_PORT, WS_PATH);
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(5000);
  ws.enableHeartbeat(15000, 3000, 2);

  Serial.printf("[%lu] [ESP-BRIDGE] WebSocket client started → %s:%d%s\n",
                millis(), SERVER_HOST, SERVER_PORT, WS_PATH);
}

// ── Main loop ────────────────────────────────────────────────────────────────
void loop() {
  ws.loop();

  // WiFi watchdog
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiOk) {
      Serial.printf("[%lu] [ESP-BRIDGE] WiFi lost — reconnecting\n", millis());
      notifyNano("WIFI_LOST");
      wifiOk = false;
    }
    WiFi.reconnect();
    delay(1000);
    return;
  }
  if (!wifiOk) {
    wifiOk = true;
    Serial.printf("[%lu] [ESP-BRIDGE] WiFi restored\n", millis());
    notifyNano("WIFI_CONNECTED");
  }

  // Read line from Nano
  while (nanoSerial.available()) {
    char c = nanoSerial.read();
    if (c == '\n') {
      lineBuffer.trim();
      if (lineBuffer.length() > 0 && wsConnected) {
        forwardToWs(lineBuffer);
      }
      lineBuffer = "";
    } else {
      lineBuffer += c;
      if (lineBuffer.length() > 256) {
        Serial.printf("[%lu] [ESP-BRIDGE] Line buffer overflow — discarding\n", millis());
        lineBuffer = "";
      }
    }
  }
}
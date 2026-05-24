/*
  Arduino Nano #1 — Pump control + HC-SR04 level sensor
  Connects to Raspberry Pi via ESP8266 WebSocket

  Wiring:
    D2  ← ESP8266 TX (SoftwareSerial RX)
    D3  → ESP8266 RX (via 2kΩ/1kΩ voltage divider to 3.3V)
    D5  → Relay IN1 (active-LOW, pump 1)
    D6  → Relay IN2 (active-LOW, pump 2)
    D9  → HC-SR04 TRIG
    D10 ← HC-SR04 ECHO

  Libraries required:
    - NewPing by Tim Eckel
    - ArduinoJson v6
*/

#include <SoftwareSerial.h>
#include <NewPing.h>
#include <ArduinoJson.h>

// ── Configuration ──────────────────────────────────────────────────────────
#define WIFI_SSID      "Sting's Galaxy S22 Ultra"
#define WIFI_PASS      "123456789"
#define SERVER_HOST    "10.165.149.244"
#define SERVER_PORT    8000
#define WS_PATH        "/ws/arduino"
#define STATION_ID     "station_001"

// ── Pin definitions ─────────────────────────────────────────────────────────
#define ESP_RX         2
#define ESP_TX         3
#define RELAY_PIN_1    5
#define RELAY_PIN_2    6
#define TRIG_PIN       9
#define ECHO_PIN       10
#define MAX_DISTANCE   400

// ── Timing ──────────────────────────────────────────────────────────────────
#define SENSOR_INTERVAL_MS    1000
#define RECONNECT_INTERVAL_MS 5000
#define AT_TIMEOUT_MS         8000
#define WIFI_TIMEOUT_MS       15000

// ── Logging ─────────────────────────────────────────────────────────────────
// Prefix: [uptime_ms] [NANO1] message
// Use LOG_INFO for normal events, LOG_ERROR for failures, LOG_DEBUG for verbose data.
#define LOG_INFO(msg)  do { Serial.print(F("["));  Serial.print(millis()); Serial.print(F("] [NANO1] [INFO]  ")); Serial.println(F(msg)); } while(0)
#define LOG_ERROR(msg) do { Serial.print(F("["));  Serial.print(millis()); Serial.print(F("] [NANO1] [ERROR] ")); Serial.println(F(msg)); } while(0)
#define LOG_DEBUG(msg) do { Serial.print(F("["));  Serial.print(millis()); Serial.print(F("] [NANO1] [DEBUG] ")); Serial.println(F(msg)); } while(0)

// Log with a dynamic string value appended
#define LOG_INFO_VAL(msg, val)  do { Serial.print(F("[")); Serial.print(millis()); Serial.print(F("] [NANO1] [INFO]  ")); Serial.print(F(msg)); Serial.println(val); } while(0)
#define LOG_ERROR_VAL(msg, val) do { Serial.print(F("[")); Serial.print(millis()); Serial.print(F("] [NANO1] [ERROR] ")); Serial.print(F(msg)); Serial.println(val); } while(0)
#define LOG_DEBUG_VAL(msg, val) do { Serial.print(F("[")); Serial.print(millis()); Serial.print(F("] [NANO1] [DEBUG] ")); Serial.print(F(msg)); Serial.println(val); } while(0)

// ── Globals ─────────────────────────────────────────────────────────────────
SoftwareSerial espSerial(ESP_RX, ESP_TX);
NewPing sonar(TRIG_PIN, ECHO_PIN, MAX_DISTANCE);

bool pumpsOn = false;
bool wsConnected = false;
unsigned long lastSensorSend = 0;
unsigned long lastReconnectAttempt = 0;
uint32_t reconnectCount = 0;
uint32_t messagesSent = 0;
uint32_t messagesReceived = 0;
uint32_t bufferOverflows = 0;

String espBuffer = "";

// ── WebSocket frame builder ──────────────────────────────────────────────────
void sendWebSocketFrame(const String& payload) {
  uint16_t len = payload.length();

  uint8_t mask[4];
  randomSeed(analogRead(A1) ^ analogRead(A2));
  for (int i = 0; i < 4; i++) {
    mask[i] = random(0, 256);
  }

  uint8_t header[10];
  uint8_t headerLen = 0;
  header[headerLen++] = 0x81;

  if (len <= 125) {
    header[headerLen++] = 0x80 | (uint8_t)len;
  } else if (len <= 65535) {
    header[headerLen++] = 0x80 | 126;
    header[headerLen++] = (len >> 8) & 0xFF;
    header[headerLen++] = len & 0xFF;
  } else {
    LOG_ERROR("Payload too large for WebSocket frame (>65535 bytes) — skipping");
    return;
  }

  for (int i = 0; i < 4; i++) {
    header[headerLen++] = mask[i];
  }

  uint16_t totalLen = headerLen + len;

  String cmd = "AT+CIPSEND=";
  cmd += totalLen;
  espSerial.println(cmd);
  delay(50);

  for (uint8_t i = 0; i < headerLen; i++) {
    espSerial.write(header[i]);
  }
  for (uint16_t i = 0; i < len; i++) {
    espSerial.write((uint8_t)(payload[i] ^ mask[i % 4]));
  }

  messagesSent++;
}

// ── AT command helper ────────────────────────────────────────────────────────
// Returns true if expected string found in response, false on timeout.
// Logs the full AT response at DEBUG level so failures are visible.
bool sendAT(const String& cmd, const String& expected, unsigned long timeout) {
  LOG_DEBUG_VAL("AT >> ", cmd);
  espSerial.println(cmd);

  unsigned long start = millis();
  String response = "";

  while (millis() - start < timeout) {
    while (espSerial.available()) {
      response += (char)espSerial.read();
    }
    if (response.indexOf(expected) != -1) {
      LOG_DEBUG_VAL("AT << OK, found: ", expected);
      return true;
    }
    if (response.indexOf("ERROR") != -1) {
      LOG_ERROR_VAL("AT << ERROR response for cmd: ", cmd);
      LOG_ERROR_VAL("AT << Full response: ", response);
      return false;
    }
  }

  LOG_ERROR_VAL("AT << TIMEOUT waiting for: ", expected);
  LOG_ERROR_VAL("AT << Received so far: ", response);
  return false;
}

// ── Pump control ─────────────────────────────────────────────────────────────
void setPumps(bool on) {
  bool prev = pumpsOn;
  digitalWrite(RELAY_PIN_1, on ? LOW : HIGH);
  digitalWrite(RELAY_PIN_2, on ? LOW : HIGH);
  pumpsOn = on;

  if (prev != on) {
    if (on) {
      LOG_INFO("Pumps turned ON (relay energized — both channels LOW)");
    } else {
      LOG_INFO("Pumps turned OFF (relay released — both channels HIGH)");
    }
  }
}

// ── WiFi + WebSocket connection ───────────────────────────────────────────────
bool connectWiFi() {
  LOG_INFO("Resetting ESP8266...");
  sendAT("AT+RST", "ready", 3000);
  delay(500);

  LOG_INFO("Setting WiFi station mode (CWMODE=1)...");
  if (!sendAT("AT+CWMODE=1", "OK", 2000)) {
    LOG_ERROR("Failed to set CWMODE=1");
    return false;
  }

  LOG_INFO_VAL("Connecting to WiFi SSID: ", WIFI_SSID);
  String joinCmd = "AT+CWJAP=\"";
  joinCmd += WIFI_SSID;
  joinCmd += "\",\"";
  joinCmd += WIFI_PASS;
  joinCmd += "\"";

  if (!sendAT(joinCmd, "WIFI GOT IP", WIFI_TIMEOUT_MS)) {
    LOG_ERROR("WiFi connection failed — check SSID/password or signal strength");
    return false;
  }

  LOG_INFO("WiFi connected, IP assigned");
  return true;
}

bool connectWebSocket() {
  LOG_INFO_VAL("Opening TCP to ", SERVER_HOST);
  String cipCmd = "AT+CIPSTART=\"TCP\",\"";
  cipCmd += SERVER_HOST;
  cipCmd += "\",";
  cipCmd += SERVER_PORT;

  if (!sendAT(cipCmd, "CONNECT", AT_TIMEOUT_MS)) {
    LOG_ERROR("TCP connection failed — check SERVER_HOST and port, ensure Raspberry Pi is running");
    return false;
  }

  LOG_INFO("TCP connected. Sending WebSocket upgrade request...");
  delay(100);

  String wsKey = "dGhlIHNhbXBsZSBub25jZQ==";
  String httpReq = "GET ";
  httpReq += WS_PATH;
  httpReq += " HTTP/1.1\r\n";
  httpReq += "Host: ";
  httpReq += SERVER_HOST;
  httpReq += ":";
  httpReq += SERVER_PORT;
  httpReq += "\r\n";
  httpReq += "Upgrade: websocket\r\n";
  httpReq += "Connection: Upgrade\r\n";
  httpReq += "Sec-WebSocket-Key: ";
  httpReq += wsKey;
  httpReq += "\r\n";
  httpReq += "Sec-WebSocket-Version: 13\r\n";
  httpReq += "\r\n";

  String sendCmd = "AT+CIPSEND=";
  sendCmd += httpReq.length();
  espSerial.println(sendCmd);
  delay(100);
  espSerial.print(httpReq);

  LOG_INFO("HTTP upgrade sent. Waiting for 101 Switching Protocols...");

  unsigned long start = millis();
  String response = "";
  while (millis() - start < AT_TIMEOUT_MS) {
    while (espSerial.available()) {
      response += (char)espSerial.read();
    }
    if (response.indexOf("101") != -1 && response.indexOf("Switching") != -1) {
      LOG_INFO("WebSocket handshake OK — connection established");
      return true;
    }
    if (response.indexOf("ERROR") != -1) {
      LOG_ERROR("WebSocket handshake rejected with ERROR");
      LOG_ERROR_VAL("Server response: ", response);
      return false;
    }
    if (response.indexOf("CLOSED") != -1) {
      LOG_ERROR("TCP connection closed during WebSocket handshake");
      return false;
    }
  }

  LOG_ERROR("WebSocket handshake timed out — no 101 response received");
  LOG_ERROR_VAL("Partial response: ", response);
  return false;
}

// ── Send sensor reading ───────────────────────────────────────────────────────
void sendSensorData() {
  unsigned int distance = sonar.ping_cm();

  if (distance == 0) {
    distance = MAX_DISTANCE;
    LOG_DEBUG("HC-SR04: no echo — using MAX_DISTANCE (tank may be empty or sensor blocked)");
  }

  StaticJsonDocument<128> doc;
  doc["type"] = "sensor_data";
  doc["device"] = "nano1";
  doc["station_id"] = STATION_ID;
  doc["distance_cm"] = distance;
  doc["pumps"] = pumpsOn;

  String payload;
  serializeJson(doc, payload);

  LOG_DEBUG_VAL("Sending sensor data: ", payload);
  sendWebSocketFrame(payload);
}

// ── Parse incoming WebSocket frame ────────────────────────────────────────────
void handleIncoming(const String& raw) {
  int ipdIdx = raw.indexOf("+IPD,");
  if (ipdIdx == -1) return;

  int colonIdx = raw.indexOf(':', ipdIdx);
  if (colonIdx == -1) {
    LOG_ERROR("Malformed +IPD packet — no colon separator found");
    return;
  }

  String data = raw.substring(colonIdx + 1);

  if (data.length() < 3) {
    LOG_ERROR_VAL("WS frame too short to parse, length=", data.length());
    return;
  }

  uint8_t opcode = (uint8_t)data[0] & 0x0F;

  if (opcode == 0x8) {
    LOG_INFO("Received WebSocket CLOSE frame from server");
    wsConnected = false;
    return;
  }

  if (opcode == 0x9) {
    LOG_DEBUG("Received WebSocket PING frame — server keepalive");
    return;
  }

  if (opcode != 0x1) {
    LOG_DEBUG_VAL("Ignoring non-text WS frame, opcode=0x", String(opcode, HEX));
    return;
  }

  uint8_t payloadLen = (uint8_t)data[1] & 0x7F;
  String json = data.substring(2, 2 + payloadLen);

  LOG_DEBUG_VAL("Received command JSON: ", json);

  StaticJsonDocument<128> doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    LOG_ERROR_VAL("JSON parse error: ", err.c_str());
    LOG_ERROR_VAL("Raw JSON string was: ", json);
    return;
  }

  const char* msgType = doc["type"];
  const char* action = doc["action"];

  if (!msgType || strcmp(msgType, "command") != 0) {
    LOG_DEBUG_VAL("Ignoring non-command message, type=", msgType ? msgType : "null");
    return;
  }

  if (!action) {
    LOG_ERROR("Command message has no 'action' field");
    return;
  }

  messagesReceived++;

  if (strcmp(action, "pumps_on") == 0) {
    LOG_INFO("Command received: pumps_on");
    setPumps(true);
  } else if (strcmp(action, "pumps_off") == 0) {
    LOG_INFO("Command received: pumps_off");
    setPumps(false);
  } else {
    LOG_ERROR_VAL("Unknown command action: ", action);
  }
}

// ── Print stats to Serial ────────────────────────────────────────────────────
void printStats() {
  Serial.print(F("["));
  Serial.print(millis());
  Serial.println(F("] [NANO1] [STATS] ── Runtime statistics ──────────────"));
  Serial.print(F("[NANO1] [STATS]   Uptime (ms):        ")); Serial.println(millis());
  Serial.print(F("[NANO1] [STATS]   Reconnect attempts: ")); Serial.println(reconnectCount);
  Serial.print(F("[NANO1] [STATS]   Messages sent:      ")); Serial.println(messagesSent);
  Serial.print(F("[NANO1] [STATS]   Commands received:  ")); Serial.println(messagesReceived);
  Serial.print(F("[NANO1] [STATS]   Buffer overflows:   ")); Serial.println(bufferOverflows);
  Serial.print(F("[NANO1] [STATS]   Pumps state:        ")); Serial.println(pumpsOn ? "ON" : "OFF");
  Serial.print(F("[NANO1] [STATS]   WS connected:       ")); Serial.println(wsConnected ? "YES" : "NO");
  Serial.println(F("[NANO1] [STATS] ────────────────────────────────────────"));
}

// ── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(9600);
  espSerial.begin(9600);

  Serial.println();
  LOG_INFO("=== Arduino Nano #1 (pumps + level) starting ===");
  LOG_INFO_VAL("Station ID: ", STATION_ID);
  LOG_INFO_VAL("Server: ", SERVER_HOST);

  pinMode(RELAY_PIN_1, OUTPUT);
  pinMode(RELAY_PIN_2, OUTPUT);
  setPumps(false);
  LOG_INFO("Relay pins configured. Pumps defaulted to OFF.");

  LOG_INFO("Starting WiFi connection...");
  if (!connectWiFi()) {
    LOG_ERROR("Initial WiFi connection failed. Will retry in main loop.");
    return;
  }

  LOG_INFO("Starting WebSocket connection...");
  if (connectWebSocket()) {
    wsConnected = true;
    LOG_INFO("=== Startup complete. Streaming sensor data. ===");
  } else {
    LOG_ERROR("Initial WebSocket connection failed. Will retry in main loop.");
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
unsigned long lastStatsPrint = 0;
#define STATS_INTERVAL_MS 60000  // print stats every 60 seconds

void loop() {
  unsigned long now = millis();

  // Accumulate incoming ESP8266 data
  while (espSerial.available()) {
    char c = espSerial.read();
    espBuffer += c;

    if (espBuffer.endsWith("CLOSED")) {
      LOG_ERROR("ESP8266 reported connection CLOSED");
      wsConnected = false;
      espBuffer = "";
    } else if (espBuffer.endsWith("ERROR")) {
      LOG_ERROR("ESP8266 reported ERROR on connection");
      wsConnected = false;
      espBuffer = "";
    }

    if (espBuffer.indexOf("+IPD,") != -1 && espBuffer.length() > 10) {
      handleIncoming(espBuffer);
      espBuffer = "";
    }

    if (espBuffer.length() > 512) {
      bufferOverflows++;
      LOG_ERROR_VAL("Receive buffer overflow (512 bytes) — discarding. Total overflows: ", bufferOverflows);
      espBuffer = "";
    }
  }

  // Reconnect logic
  if (!wsConnected && (now - lastReconnectAttempt > RECONNECT_INTERVAL_MS)) {
    lastReconnectAttempt = now;
    reconnectCount++;
    LOG_INFO_VAL("Reconnect attempt #", reconnectCount);

    setPumps(false);  // safety: ensure pumps are off while disconnected

    if (!connectWiFi()) {
      LOG_ERROR_VAL("WiFi reconnect failed. Next attempt in ms: ", RECONNECT_INTERVAL_MS);
      return;
    }
    if (connectWebSocket()) {
      wsConnected = true;
      LOG_INFO("Reconnected successfully");
    } else {
      LOG_ERROR_VAL("WebSocket reconnect failed. Next attempt in ms: ", RECONNECT_INTERVAL_MS);
    }
  }

  // Send sensor data periodically
  if (wsConnected && (now - lastSensorSend >= SENSOR_INTERVAL_MS)) {
    lastSensorSend = now;
    sendSensorData();
  }

  // Print periodic stats
  if (now - lastStatsPrint >= STATS_INTERVAL_MS) {
    lastStatsPrint = now;
    printStats();
  }
}

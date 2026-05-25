#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <SoftwareSerial.h>

#define WIFI_SSID    "Sting's Galaxy S22 Ultra"
#define WIFI_PASS    "123456789"
#define SERVER_HOST  "10.165.149.244"
#define SERVER_PORT  8000
#define WS_PATH      "/ws/arduino"

#define NANO_RX_PIN  D5
#define NANO_TX_PIN  D6

#define STATUS_INTERVAL_MS  10000

SoftwareSerial nanoSerial(NANO_RX_PIN, NANO_TX_PIN);
WebSocketsClient webSocket;

String nanoBuffer = "";
bool wsConnected = false;
unsigned long lastStatusSend = 0;

#define LOG(msg)       do { Serial.print("["); Serial.print(millis()); Serial.print("] [ESP] "); Serial.println(msg); } while(0)
#define LOG_VAL(msg,v) do { Serial.print("["); Serial.print(millis()); Serial.print("] [ESP] "); Serial.print(msg); Serial.println(v); } while(0)

void sendStatusToNano() {
  if (wsConnected) {
    nanoSerial.println("{\"type\":\"status\",\"ws\":true}");
  } else {
    nanoSerial.println("{\"type\":\"status\",\"ws\":false}");
  }
}

void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      LOG("WebSocket disconnected");
      wsConnected = false;
      sendStatusToNano();
      break;

    case WStype_CONNECTED:
      LOG_VAL("WebSocket connected: ", (char*)payload);
      wsConnected = true;
      sendStatusToNano();
      break;

    case WStype_TEXT:
      LOG_VAL("WS >> Nano: ", (char*)payload);
      nanoSerial.write(payload, length);
      nanoSerial.write('\n');
      break;

    case WStype_ERROR:
      LOG("WebSocket error");
      break;

    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  nanoSerial.begin(9600);
  delay(200);
  Serial.println();
  LOG("=== ESP8266 WiFi bridge starting ===");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  LOG_VAL("Connecting to WiFi: ", WIFI_SSID);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    LOG_VAL("WiFi OK, IP: ", WiFi.localIP().toString());
  } else {
    LOG("WiFi failed, will retry in background");
  }

  webSocket.begin(SERVER_HOST, SERVER_PORT, WS_PATH);
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000);
  LOG("WebSocket client started");
}

void loop() {
  webSocket.loop();

  if (millis() - lastStatusSend >= STATUS_INTERVAL_MS) {
    lastStatusSend = millis();
    sendStatusToNano();
    LOG_VAL("Status sent to Nano, ws=", wsConnected ? "true" : "false");
  }

  while (nanoSerial.available()) {
    char c = nanoSerial.read();
    if (c == '\n') {
      nanoBuffer.trim();
      if (nanoBuffer.length() > 0) {
        LOG_VAL("Nano >> WS: ", nanoBuffer);
        if (wsConnected) {
          webSocket.sendTXT(nanoBuffer);
        } else {
          LOG("WS not connected, dropping message");
        }
      }
      nanoBuffer = "";
    } else {
      nanoBuffer += c;
      if (nanoBuffer.length() > 256) {
        LOG("Buffer overflow, clearing");
        nanoBuffer = "";
      }
    }
  }
}
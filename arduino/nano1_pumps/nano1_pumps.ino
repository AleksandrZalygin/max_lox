#include <SoftwareSerial.h>
#include <NewPing.h>
#include <ArduinoJson.h>

#define STATION_ID  "station_001"

#define ESP_RX        2
#define ESP_TX        3
#define RELAY_PIN_1   5
#define RELAY_PIN_2   6
#define TRIG_PIN      9
#define ECHO_PIN      10
#define MAX_DISTANCE  400

#define SENSOR_INTERVAL_MS  1000
#define STATS_INTERVAL_MS   60000

#define LOG_INFO(msg)          do { Serial.print(F("[")); Serial.print(millis()); Serial.print(F("] [NANO1] [INFO]  ")); Serial.println(F(msg)); } while(0)
#define LOG_ERROR(msg)         do { Serial.print(F("[")); Serial.print(millis()); Serial.print(F("] [NANO1] [ERROR] ")); Serial.println(F(msg)); } while(0)
#define LOG_INFO_VAL(msg, val) do { Serial.print(F("[")); Serial.print(millis()); Serial.print(F("] [NANO1] [INFO]  ")); Serial.print(F(msg)); Serial.println(val); } while(0)
#define LOG_ERROR_VAL(msg,val) do { Serial.print(F("[")); Serial.print(millis()); Serial.print(F("] [NANO1] [ERROR] ")); Serial.print(F(msg)); Serial.println(val); } while(0)

SoftwareSerial espSerial(ESP_RX, ESP_TX);
NewPing sonar(TRIG_PIN, ECHO_PIN, MAX_DISTANCE);

bool pumpsOn = false;
bool wsConnected = false;
unsigned long lastSensorSend = 0;
unsigned long lastStatsPrint = 0;
uint32_t messagesSent = 0;
uint32_t messagesReceived = 0;
String espBuffer = "";

void setPumps(bool on) {
  bool prev = pumpsOn;
  digitalWrite(RELAY_PIN_1, on ? LOW : HIGH);
  digitalWrite(RELAY_PIN_2, on ? LOW : HIGH);
  pumpsOn = on;
  if (prev != on) {
    LOG_INFO_VAL("Pumps: ", on ? "ON" : "OFF");
  }
}

void sendSensorData() {
  unsigned int distance = sonar.ping_cm();
  if (distance == 0) distance = MAX_DISTANCE;

  StaticJsonDocument<128> doc;
  doc["type"]        = "sensor_data";
  doc["device"]      = "nano1";
  doc["station_id"]  = STATION_ID;
  doc["distance_cm"] = distance;
  doc["pumps"]       = pumpsOn;

  serializeJson(doc, espSerial);
  espSerial.println();
  messagesSent++;

  Serial.print(F("["));
  Serial.print(millis());
  Serial.print(F("] [NANO1] [INFO]  Sent: distance="));
  Serial.print(distance);
  Serial.print(F("cm pumps="));
  Serial.print(pumpsOn ? "ON" : "OFF");
  Serial.print(F(" ws="));
  Serial.println(wsConnected ? "YES" : "NO");
}

void handleLine(const String& line) {
  LOG_INFO_VAL("ESP >> ", line);

  StaticJsonDocument<128> doc;
  DeserializationError err = deserializeJson(doc, line);
  if (err) {
    LOG_ERROR_VAL("JSON parse error: ", err.c_str());
    return;
  }

  const char* msgType = doc["type"];

  if (!msgType) {
    LOG_ERROR("No type field");
    return;
  }

  if (strcmp(msgType, "status") == 0) {
    wsConnected = doc["ws"];
    LOG_INFO_VAL("ESP WebSocket: ", wsConnected ? "CONNECTED" : "DISCONNECTED");
    return;
  }

  if (strcmp(msgType, "command") == 0) {
    const char* action = doc["action"];
    if (!action) {
      LOG_ERROR("Command without action");
      return;
    }

    messagesReceived++;

    if (strcmp(action, "pumps_on") == 0) {
      setPumps(true);
    } else if (strcmp(action, "pumps_off") == 0) {
      setPumps(false);
    } else {
      LOG_ERROR_VAL("Unknown action: ", action);
    }
    return;
  }

  LOG_INFO_VAL("Ignoring type: ", msgType);
}

void setup() {
  Serial.begin(9600);
  espSerial.begin(9600);

  Serial.println();
  LOG_INFO("=== Arduino Nano #1 starting ===");
  LOG_INFO_VAL("Station ID: ", STATION_ID);

  pinMode(RELAY_PIN_1, OUTPUT);
  pinMode(RELAY_PIN_2, OUTPUT);
  setPumps(false);
  LOG_INFO("Relays configured, pumps OFF");
  LOG_INFO("Waiting for ESP bridge...");
}

void loop() {
  unsigned long now = millis();

  while (espSerial.available()) {
    char c = espSerial.read();
    if (c == '\n') {
      espBuffer.trim();
      if (espBuffer.length() > 0) {
        handleLine(espBuffer);
      }
      espBuffer = "";
    } else if (c != '\r') {
      espBuffer += c;
      if (espBuffer.length() > 256) {
        LOG_ERROR("ESP buffer overflow");
        espBuffer = "";
      }
    }
  }

  if (now - lastSensorSend >= SENSOR_INTERVAL_MS) {
    lastSensorSend = now;
    sendSensorData();
  }

  if (now - lastStatsPrint >= STATS_INTERVAL_MS) {
    lastStatsPrint = now;
    LOG_INFO_VAL("Stats sent:     ", messagesSent);
    LOG_INFO_VAL("Stats received: ", messagesReceived);
    LOG_INFO_VAL("Stats pumps:    ", pumpsOn ? "ON" : "OFF");
    LOG_INFO_VAL("Stats ws:       ", wsConnected ? "YES" : "NO");
  }
}
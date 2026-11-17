#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#define BUZZER_PIN 6
#define TEMP_LIMIT_CELSIUS 65.0f

// Notas musicais (Hz)
#define NOTE_G4 392
#define NOTE_C5 523
#define NOTE_E5 659
#define NOTE_G5 784
#define NOTE_A5 880

#define SERVICE_UUID     "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BUZZER_CHAR_UUID "beb5483e-36e1-4688-b7f5-ea07361b26aa"

BLEServer* pServer = nullptr;
bool deviceConnected = false;
volatile bool shouldPlayMario = false;
volatile bool shouldPlayDisconnect = false;
unsigned long lastTempCheck = 0;

void silenceBuzzer() {
  ledcWriteTone(BUZZER_PIN, 0);
  ledcWrite(BUZZER_PIN, 0);
}

void playMarioTheme() {
  int melody[] = {
    NOTE_E5, NOTE_E5, 0, NOTE_E5,
    0, NOTE_C5, NOTE_E5, 0,
    NOTE_G5, 0, 0, 0,
    NOTE_G4
  };

  int durations[] = {
    120, 120, 120, 120,
    120, 120, 120, 120,
    150, 150, 150, 150,
    250
  };

  int notesCount = sizeof(melody) / sizeof(melody[0]);

  for (int i = 0; i < notesCount; i++) {
    if (melody[i] == 0) {
      silenceBuzzer();
    } else {
      ledcWriteTone(BUZZER_PIN, melody[i]);
    }
    delay(durations[i]);
    silenceBuzzer();
    delay(25);
  }

  silenceBuzzer();
}

// Regra local R2: 3 bipes curtos ao perder conexão com o smartphone
void playDisconnectAlert() {
  for (int i = 0; i < 3; i++) {
    ledcWriteTone(BUZZER_PIN, NOTE_A5);
    delay(110);
    silenceBuzzer();
    delay(90);
  }
}

// Regra local R1: alerta térmico caso o chip ultrapasse 65 °C
void playThermalAlert() {
  for (int i = 0; i < 4; i++) {
    ledcWriteTone(BUZZER_PIN, 1200);
    delay(80);
    silenceBuzzer();
    delay(60);
  }
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    deviceConnected = true;
    Serial.println("[BLE] iPhone conectado!");
  }

  void onDisconnect(BLEServer* server) override {
    deviceConnected = false;
    shouldPlayDisconnect = true;
    Serial.println("[BLE] iPhone desconectado. Reiniciando anuncio...");
    BLEDevice::startAdvertising();
  }
};

class BuzzerCallbacks : public BLECharacteristicCallbacks {
  void handleWrite(BLECharacteristic* pCharacteristic) {
    String rxValue = pCharacteristic->getValue();
    // Valida payload estruturado ('1' / 0x31) antes de acionar o atuador
    if (rxValue == "1") {
      Serial.println("[BLE] Comando valido ('1') recebido!");
      shouldPlayMario = true;
    } else {
      Serial.println("[BLE] Payload ignorado (comando invalido).");
    }
  }

  void onWrite(BLECharacteristic* pCharacteristic) override {
    handleWrite(pCharacteristic);
  }

  void onWrite(BLECharacteristic* pCharacteristic, ble_gap_conn_desc* desc) override {
    handleWrite(pCharacteristic);
  }
};

void setup() {
  Serial.begin(115200);
  delay(300);

  // Inicializa PWM no pino 6 em 0V
  ledcAttach(BUZZER_PIN, 2000, 8);
  silenceBuzzer();

  playMarioTheme();

  BLEDevice::init("KeepNear Tag");
  BLEDevice::setPower(ESP_PWR_LVL_P9, ESP_BLE_PWR_TYPE_DEFAULT);
  BLEDevice::setPower(ESP_PWR_LVL_P9, ESP_BLE_PWR_TYPE_ADV);
  BLEDevice::setPower(ESP_PWR_LVL_P9, ESP_BLE_PWR_TYPE_SCAN);

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  BLECharacteristic* pBuzzerChar = pService->createCharacteristic(
    BUZZER_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  pBuzzerChar->setValue("0");
  pBuzzerChar->setCallbacks(new BuzzerCallbacks());

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);

  BLEAdvertisementData advData;
  advData.setFlags(ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT);
  advData.setCompleteServices(BLEUUID(SERVICE_UUID));

  uint8_t mfgBytes[8] = {0xFF, 0xFF, 0x01, 0x02, 0x03, 0x04, 0x00, 0xFF};
  String mfgData((char*)mfgBytes, 8);
  advData.setManufacturerData(mfgData);

  pAdvertising->setAdvertisementData(advData);
  BLEDevice::startAdvertising();

  Serial.println("[SYS] KeepNear Tag pronta e anunciando.");
}

void loop() {
  // 1. Acionamento remoto validado pelo app
  if (shouldPlayMario) {
    shouldPlayMario = false;
    Serial.println("[AUDIO] Tocando tema do Mario...");
    playMarioTheme();
  }

  // 2. Decisão local anti-esquecimento ao desconectar
  if (shouldPlayDisconnect) {
    shouldPlayDisconnect = false;
    Serial.println("[ALERTA] Perda de conexao! Emitindo 3 bipes locais...");
    playDisconnectAlert();
  }

  // 3. Percepção e ação térmica local a cada 2 segundos
  if (millis() - lastTempCheck >= 2000) {
    lastTempCheck = millis();
    float chipTemp = temperatureRead();
    if (chipTemp >= TEMP_LIMIT_CELSIUS) {
      Serial.printf("[TERMICO] Temperatura critica (%.1f C)! Acionando alarme...\n", chipTemp);
      playThermalAlert();
    }
  }

  delay(15);
}

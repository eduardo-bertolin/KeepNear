# KeepNear — Sistema IoT de Rastreamento de Proximidade

Sistema completo de localização de objetos pessoais baseado em **Bluetooth Low Energy (BLE)**, composto por uma tag inteligente embarcada em **ESP32-C6** e um aplicativo mobile desenvolvido em **React Native (Expo)**. O projeto combina leitura de sensor térmico interno, decisões autônomas offline no microcontrolador, filtragem digital de sinal (EMA), feedback tátil dinâmico e registro local de última localização por GPS (*Privacy by Design*).

---

## 🏗️ Arquitetura e Requisitos Atendidos

O ecossistema é dividido em duas camadas desacopladas que operam sem dependência de internet ou servidores em nuvem:

1. **Firmware Embarcado (`src/main.cpp` — `ESP32-C6` / `nanoESP32-C6`):**
   * **Percepção e Ação (R1):** Monitora continuamente o sensor interno de temperatura do silício (`temperatureRead()`) a cada `2000 ms` e aciona o buzzer piezoelétrico (`GPIO 6`, PWM via `ledcAttach`) caso a placa atinja o limiar crítico de **65,0 °C** (`playThermalAlert()`).
   * **Decisão Local Autônoma (R2):** Executa duas regras localmente no microcontrolador sem depender do smartphone ou de internet:
     1. *Proteção térmica ($\ge 65,0\,^\circ\text{C}$):* disparo automático de 4 bipes agudos (`1200 Hz`).
     2. *Alerta anti-esquecimento (`onDisconnect`):* ao detectar a perda do enlace BLE com o celular, emite **3 bipes curtos** (`880 Hz` / `NOTE_A5`) na própria tag e reinicia o *Advertising* para permitir reconexão.
   * **Comunicação BLE e Segurança (R3 / R4):** Atua como periférico BLE enviando pacotes estruturados de *Advertising* e expondo um servidor **GATT** que valida o payload recebido (`rxValue == "1"` / `0x31`) antes de executar a melodia de localização (`playMarioTheme()`).

2. **Aplicativo Mobile (`keep-near-app/App.tsx`):**
   * **Interface e Telemetria (R5):** Desenvolvido em **React Native + TypeScript** (`react-native-ble-plx` e `expo-location`), exibe em tempo real o percentual de proximidade, tendência do sinal (`↑`, `↓`, `•`), pico de aproximação, fonte de energia e status de sincronização sem necessidade de Monitor Serial.
   * **Privacy by Design:** A tag não possui receptor GPS nem transmite coordenadas pela rede. A geolocalização é capturada e armazenada exclusivamente no smartphone do proprietário no momento do cadastro, conexão ou desconexão BLE.

---

## ⚙️ Protocolo e Algoritmos

### 1. Payload Estruturado (BLE Advertising & GATT)
* **Service UUID:** `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
* **Characteristic UUID (Buzzer):** `beb5483e-36e1-4688-b7f5-ea07361b26aa`
* **Comando de Acionamento (GATT Write):** String `'1'` (`0x31` em ASCII / `'MQ=='` em Base64). Qualquer outro payload é descartado pelo firmware.
* **Manufacturer Data (8 bytes):**

| Byte(s) | Campo | Exemplo (Hex) | Descrição |
| :--- | :--- | :--- | :--- |
| `0..1` | Company ID | `0xFF 0xFF` | Identificador de fabricante para testes/prototipagem |
| `2..5` | Hardware ID | `0x01 0x02 0x03 0x04` | Identificador único da tag exibido como `01:02:03:04` |
| `6` | Reservado | `0x00` | Byte reservado para expansão futura |
| `7` | Fonte de Energia | `0xFF` | `0xFF` indica alimentação `USB`; `0x00–0x64` indica `%` de bateria |

### 2. Filtragem de Proximidade (EMA) e Feedback Tátil
Para estabilizar oscilações de rádio em 2,4 GHz durante leituras contínuas (`200 ms`):
1. **Filtro EMA ($\alpha = 0.28$):**
   $$\text{RSSI}_{\text{suavizado}} = \text{RSSI}_{\text{anterior}} + 0.28 \times (\text{RSSI}_{\text{atual}} - \text{RSSI}_{\text{anterior}})$$
2. **Curva de Proximidade Calibrada (`-97 dBm` a `-51 dBm`):**
   $$\text{Força (\%)} = \text{round}\left(\left(\frac{\text{RSSI} - (-97)}{-51 - (-97)}\right)^{0.65} \times 100\right)$$
3. **Pulso Tátil:** Ajusta o intervalo de vibração do smartphone conforme a intensidade do sinal (de `1500 ms` distante até `200 ms` quando $\ge 85\%$).

---

## 📂 Estrutura do Repositório

```text
KeepNear/
├── src/
│   └── main.cpp              # Firmware C++ do ESP32-C6 (BLE, Sensor Térmico 65 °C e Buzzer)
├── platformio.ini            # Configuração da placa ESP32-C6 e flags de build
├── .env.example              # Exemplo de parâmetros e UUIDs de configuração
├── .gitignore                # Arquivos e pastas ignorados no controle de versão
└── keep-near-app/
    ├── App.tsx               # Aplicação React Native (Radar EMA, BLE GATT e GPS local)
    ├── app.json              # Permissões nativas de Bluetooth e Localização (iOS/Android)
    └── package.json          # Dependências do aplicativo mobile
```

---

## 🛠️ Pré-requisitos

* **Hardware:** Placa ESP32-C6 (ex.: *nanoESP32-C6*) com buzzer conectado ao `GPIO 6` e cabo USB-C.
* **Firmware:** [VS Code](https://code.visualstudio.com/) com a extensão **PlatformIO IDE**.
* **Mobile:** [Node.js](https://nodejs.org/) (v18+), **Xcode** (para build iOS) ou **Android Studio**, e dispositivo físico com Bluetooth e GPS ativados.

> **Nota:** Como o projeto utiliza módulos nativos de Bluetooth (`react-native-ble-plx`), ele deve ser executado via **Development Build** (`expo run:ios` / `expo run:android`), e não pelo Expo Go padrão.

---

## 🚀 Como Rodar o Projeto

### 1. Clonar o Repositório
```bash
git clone [https://github.com/eduardo-bertolin/KeepNear.git](https://github.com/eduardo-bertolin/KeepNear.git)
cd KeepNear
```

### 2. Gravar o Firmware no ESP32-C6
1. Abra a pasta raiz `KeepNear` no **VS Code** com o **PlatformIO** instalado.
2. Conecte o **ESP32-C6** via USB.
3. Compile e envie o firmware pelo ícone **PlatformIO: Upload** (`→`) ou via terminal:
   ```bash
   pio run --target upload
   ```
   *(Ao energizar a placa, o buzzer tocará a melodia inicial confirmando que o anúncio BLE está ativo).*

### 3. Instalar e Executar o Aplicativo Mobile
1. Acesse o diretório do aplicativo e instale as dependências:
   ```bash
   cd keep-near-app
   npm install
   ```
2. Compile e instale o app no dispositivo físico conectado via USB:
   * **iOS (macOS + Xcode):**
     ```bash
     npx expo run:ios --device
     ```
   * **Android:**
     ```bash
     npx expo run:android --device
     ```
3. Caso o build nativo já esteja instalado no aparelho, inicie apenas o servidor de desenvolvimento:
   ```bash
   npx expo start --dev-client
   ```

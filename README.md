# KeepNear — Sistema IoT de Rastreamento de Proximidade

Sistema de localização de objetos pessoais baseado em **Bluetooth Low Energy (BLE)**, composto por uma tag inteligente embarcada em **ESP32-C6** e um aplicativo mobile desenvolvido em **React Native (Expo)**. O projeto combina filtragem digital de sinal (EMA), feedback tátil dinâmico, acionamento sonoro remoto via GATT e registro local de última localização por GPS (*Privacy by Design*).

---

## 🏗️ Arquitetura do Sistema

O ecossistema é dividido em duas camadas desacopladas que se comunicam via protocolo BLE:

1. **Firmware Embarcado (`nanoESP32-C6` / `ESP32-C6`):**
   * Atua como periférico BLE emitindo pacotes contínuos de *Advertising* com dados do fabricante (*Manufacturer Data*).
   * Expõe um servidor **GATT** para receber comandos de acionamento do buzzer piezoelétrico.
   * Não possui módulo GPS integrado, garantindo baixo consumo energético e privacidade física do hardware.

2. **Aplicativo Mobile (`keep-near-app`):**
   * Desenvolvido em **React Native + TypeScript** utilizando `react-native-ble-plx` e `expo-location`.
   * Realiza varredura contínua, leitura de RSSI em tempo real (intervalo de `200 ms` quando conectado), filtragem de ruído e cálculo percentual de proximidade.
   * Gerencia a geolocalização **exclusivamente no smartphone**, capturando coordenadas e endereço apenas no dispositivo do proprietário.

---

## ⚙️ Como o Código Funciona

### 1. Protocolo BLE e Telemetria (`App.tsx`)
* **Service UUID:** `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
* **Characteristic UUID (Buzzer):** `beb5483e-36e1-4688-b7f5-ea07361b26aa`
* **Decodificação de *Manufacturer Data*:** A função `parseManufacturerData()` decodifica a string Base64 recebida no pacote de anúncio para extrair:
  * **Hardware ID (4 bytes):** Identificador único exibido no formato hexadecimal (`XX:XX:XX:XX`).
  * **Fonte de Energia (1 byte):** Identifica alimentação via `USB` (`0xFF`) ou percentual de bateria.
* **Acionamento Sonoro:** Ao tocar em **"Tocar Som na Tag"**, o aplicativo envia o payload `'MQ=='` (caractere `'1'` em Base64) para a característica GATT, disparando o alerta sonoro na tag.

### 2. Algoritmo de Proximidade e Filtro EMA
Como sinais de rádio de 2.4 GHz sofrem atenuação e reflexões constantes, o aplicativo trata o sinal bruto em três etapas:

1. **Suavização Exponencial (EMA):** Aplica um fator de amortecimento $\alpha = 0.28$ para eliminar picos espúrios sem perder responsividade ao movimento:
   $$\text{RSSI}_{\text{suavizado}} = \text{RSSI}_{\text{anterior}} + 0.28 \times (\text{RSSI}_{\text{atual}} - \text{RSSI}_{\text{anterior}})$$
2. **Normalização e Curva Não-Linear:** Mapeia o sinal calibrado entre `-97 dBm` (0%) e `-51 dBm` (100%) e aplica um expoente de curva (`0.65`) para tornar a escala percentual mais intuitiva conforme o usuário se aproxima:
   $$\text{Força (\%)} = \text{round}\left(\left(\frac{\text{RSSI} - (-97)}{-51 - (-97)}\right)^{0.65} \times 100\right)$$
3. **Tendência e Pulso Tátil:** Calcula o delta entre leituras consecutivas ($\pm 0.8\text{ dBm}$) para indicar se o sinal está subindo (`↑`), caindo (`↓`) ou estável (`•`), ajustando a frequência de vibração do smartphone (de `1500 ms` distante até `200 ms` quando a proximidade atinge $\ge 85\%$).

### 3. Geolocalização ("Visto por Último")
* **Gatilhos Automáticos (`captureTagLocation`):** A posição GPS do smartphone é capturada e convertida em endereço legível via geocodificação reversa (`Location.reverseGeocodeAsync`) no cadastro da tag, no início do rastreamento e automaticamente no evento de perda de enlace (`connectedDevice.onDisconnected`).
* **Integração com Mapas (`openTagInMaps`):** Ao tocar no endereço ou no botão **"Ver no Mapa"**, o app abre diretamente o Apple Maps (iOS) ou Google Maps (Android) nas coordenadas salvas.

---

## 📂 Estrutura do Repositório

```text
KeepNear/
├── src/
│   └── main.cpp              # Firmware C++ do ESP32-C6 (BLE Advertising + GATT Buzzer)
├── platformio.ini            # Configurações de compilação e placa (ESP32-C6)
└── keep-near-app/
    ├── App.tsx               # Código principal do aplicativo (Lista, Radar EMA, BLE e GPS)
    ├── app.json              # Configurações do Expo e permissões nativas (BLE / GPS)
    └── package.json          # Dependências do projeto React Native
```

---

## 🛠️ Pré-requisitos

* **Hardware:** Placa ESP32-C6 (ex: *nanoESP32-C6*) com buzzer conectado e cabo USB-C.
* **Firmware:** [VS Code](https://code.visualstudio.com/) com a extensão **PlatformIO IDE**.
* **Mobile:** [Node.js](https://nodejs.org/) (v18+), **Xcode** (para compilar no iOS) ou **Android Studio**, e um dispositivo físico com Bluetooth ativado.

> **Nota:** Como o projeto utiliza bibliotecas nativas de Bluetooth (`react-native-ble-plx`), o aplicativo deve ser executado via **Development Build** (`expo run:ios` / `expo run:android`), e não pelo aplicativo padrão Expo Go.

---

## 🚀 Como Rodar o Projeto

### 1. Clonar o Repositório
```bash
git clone [https://github.com/eduardo-bertolin/KeepNear.git](https://github.com/eduardo-bertolin/KeepNear.git)
cd KeepNear
```

### 2. Gravar o Firmware no ESP32-C6
1. Abra a pasta raiz `KeepNear` no **VS Code** com o **PlatformIO** instalado.
2. Conecte a placa **ESP32-C6** ao computador via USB.
3. Compile e faça o upload do firmware clicando no ícone **PlatformIO: Upload** (`→`) na barra inferior ou executando no terminal:
   ```bash
   pio run --target upload
   ```

### 3. Instalar e Executar o Aplicativo Mobile
1. Acesse o diretório do aplicativo e instale as dependências:
   ```bash
   cd keep-near-app
   npm install
   ```
2. Certifique-se de que os plugins do Bluetooth e da Localização estão declarados no `app.json`:
   ```json
   "plugins": [
     "react-native-ble-plx",
     "expo-location"
   ]
   ```
3. Compile e instale o app no dispositivo físico conectado via USB:
   * **iOS (macOS + Xcode):**
     ```bash
     npx expo run:ios --device
     ```
   * **Android:**
     ```bash
     npx expo run:android --device
     ```
4. Caso o build nativo já esteja instalado no aparelho, basta iniciar o servidor de desenvolvimento:
   ```bash
   npx expo start --dev-client
   ```

---

## 📱 Fluxo de Uso

1. **Cadastrar Tag:** Toque em **"+ Cadastrar Nova Tag"**, aguarde a identificação automática do pacote BLE da placa ESP32-C6, escolha um ícone e dê um nome ao objeto.
2. **Rastrear em Tempo Real:** Selecione o item na lista e toque em **"Localizar Agora"** para acompanhar o percentual de proximidade, o gráfico de tendência e o feedback tátil.
3. **Acionar Alarme:** Com a tag conectada, toque em **"🔔 Tocar Som na Tag"** para emitir o sinal sonoro no hardware.
4. **Consultar Última Localização:** Caso a tag saia do alcance Bluetooth, o endereço da última conexão permanece salvo no card do item e pode ser aberto diretamente no mapa.

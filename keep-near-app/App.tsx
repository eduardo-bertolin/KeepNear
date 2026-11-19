import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  Text,
  TouchableOpacity,
  View,
  TextInput,
  Vibration,
  ScrollView,
  Animated,
  Alert,
  Modal,
  PanResponder,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import * as Location from 'expo-location';

const bleManager = new BleManager();
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BUZZER_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26aa';
const BUZZER_TRIGGER_BASE64 = 'MQ=='; // '1' em Base64

// Calibração real da nanoESP32-C6: -51 dBm (100%) até -97 dBm (0%)
const MIN_RSSI = -97;
const MAX_RSSI = -51;
const CURVE_EXPONENT = 0.65;

const QUICK_EMOJIS = ['🎒', '🔑', '👛', '💻', '🎧', '🧳', '🚲', '📷', '📱', '🏷️'];

interface TagMetadata {
  tagId: string;
  powerSource: string;
}

interface TagCoords {
  latitude: number;
  longitude: number;
}

interface SavedTag {
  deviceId: string;
  hardwareId: string;
  name: string;
  emoji: string;
  powerSource: string;
  lastSeen: string;
  lastLocation?: string;
  lastCoords?: TagCoords;
  lastStrength: number;
}

function parseManufacturerData(base64Data: string | null): TagMetadata | null {
  if (!base64Data) return null;
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes: number[] = [];
    const clean = base64Data.replace(/=+$/, '');

    for (let i = 0; i < clean.length; i += 4) {
      const e1 = chars.indexOf(clean[i]);
      const e2 = chars.indexOf(clean[i + 1]);
      const e3 = chars.indexOf(clean[i + 2]);
      const e4 = chars.indexOf(clean[i + 3]);

      bytes.push((e1 << 2) | (e2 >> 4));
      if (e3 !== -1) bytes.push(((e2 & 15) << 4) | (e3 >> 2));
      if (e4 !== -1) bytes.push(((e3 & 3) << 6) | e4);
    }

    if (bytes.length < 8) return null;

    const idBytes = bytes
      .slice(2, 6)
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join(':');

    const batteryByte = bytes[7];
    const powerSource = batteryByte === 0xff ? 'USB' : `${batteryByte}%`;

    return { tagId: idBytes, powerSource };
  } catch {
    return null;
  }
}

function formatCurrentTime(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function TrashIcon() {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: 24, height: 24 }}>
      <View
        style={{
          width: 8,
          height: 3,
          borderTopLeftRadius: 2,
          borderTopRightRadius: 2,
          backgroundColor: '#FFFFFF',
          marginBottom: 1,
        }}
      />
      <View
        style={{
          width: 18,
          height: 2.5,
          borderRadius: 1,
          backgroundColor: '#FFFFFF',
          marginBottom: 2,
        }}
      />
      <View
        style={{
          width: 14,
          height: 14,
          borderBottomLeftRadius: 3,
          borderBottomRightRadius: 3,
          backgroundColor: '#FFFFFF',
          flexDirection: 'row',
          justifyContent: 'space-evenly',
          alignItems: 'center',
          paddingHorizontal: 2,
        }}
      >
        <View style={{ width: 1.5, height: 8, backgroundColor: '#DC2626', borderRadius: 1 }} />
        <View style={{ width: 1.5, height: 8, backgroundColor: '#DC2626', borderRadius: 1 }} />
      </View>
    </View>
  );
}

function EmojiSelector({
  selectedEmoji,
  onSelect,
}: {
  selectedEmoji: string;
  onSelect: (emoji: string) => void;
}) {
  const handleCustomInput = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const chars = Array.from(trimmed);
    const lastChar = chars[chars.length - 1];
    if (lastChar) onSelect(lastChar);
  };

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 }}>
        Ícone da tag
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, alignItems: 'center', paddingVertical: 2 }}
      >
        <TextInput
          value={selectedEmoji}
          onChangeText={handleCustomInput}
          selectTextOnFocus
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: '#2563EB',
            backgroundColor: '#EFF6FF',
            fontSize: 22,
            textAlign: 'center',
          }}
        />

        {QUICK_EMOJIS.map((emoji) => {
          const isSelected = selectedEmoji === emoji;
          return (
            <TouchableOpacity
              key={emoji}
              onPress={() => onSelect(emoji)}
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                backgroundColor: isSelected ? '#DBEAFE' : '#F3F4F6',
                borderWidth: isSelected ? 1.5 : 1,
                borderColor: isSelected ? '#2563EB' : '#E5E7EB',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 20 }}>{emoji}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SwipeableTagCard({
  item,
  onPress,
  onDeleteRequest,
}: {
  item: SavedTag;
  onPress: () => void;
  onDeleteRequest: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const SWIPE_THRESHOLD = 85;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dx > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx > 0) {
          translateX.setValue(Math.min(gestureState.dx, 130));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx >= SWIPE_THRESHOLD) {
          Animated.spring(translateX, {
            toValue: 92,
            useNativeDriver: true,
          }).start(() => {
            Alert.alert(
              'Excluir Tag',
              `Tem certeza que deseja excluir "${item.emoji} ${item.name}"?`,
              [
                {
                  text: 'Cancelar',
                  style: 'cancel',
                  onPress: () => {
                    Animated.spring(translateX, {
                      toValue: 0,
                      useNativeDriver: true,
                    }).start();
                  },
                },
                {
                  text: 'Excluir',
                  style: 'destructive',
                  onPress: () => {
                    onDeleteRequest();
                  },
                },
              ],
              {
                cancelable: true,
                onDismiss: () => {
                  Animated.spring(translateX, {
                    toValue: 0,
                    useNativeDriver: true,
                  }).start();
                },
              }
            );
          });
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const backdropOpacity = translateX.interpolate({
    inputRange: [0, 8],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const trashOpacity = translateX.interpolate({
    inputRange: [10, 35, 85],
    outputRange: [0, 0.7, 1],
    extrapolate: 'clamp',
  });

  const trashScale = translateX.interpolate({
    inputRange: [10, 85],
    outputRange: [0.6, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ position: 'relative', borderRadius: 16, overflow: 'hidden' }}>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#DC2626',
          borderRadius: 16,
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingLeft: 24,
          opacity: backdropOpacity,
        }}
      >
        <Animated.View
          style={{
            opacity: trashOpacity,
            transform: [{ scale: trashScale }],
            alignItems: 'center',
          }}
        >
          <TrashIcon />
          <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700', marginTop: 3 }}>
            Excluir
          </Text>
        </Animated.View>
      </Animated.View>

      <Animated.View
        {...panResponder.panHandlers}
        style={{
          transform: [{ translateX }],
        }}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={onPress}
          style={{
            padding: 16,
            borderRadius: 16,
            backgroundColor: '#F9FAFB',
            borderWidth: 1,
            borderColor: '#E5E7EB',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 10 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: '#E5E7EB',
                justifyContent: 'center',
                alignItems: 'center',
                marginRight: 12,
              }}
            >
              <Text style={{ fontSize: 22 }}>{item.emoji || '🏷️'}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827' }}>
                {item.name}
              </Text>
              <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 3 }}>
                ID {item.hardwareId} • Visto às {item.lastSeen}
              </Text>
              {item.lastLocation && (
                <Text style={{ fontSize: 12, color: '#4B5563', marginTop: 2 }} numberOfLines={1}>
                  📍 {item.lastLocation}
                </Text>
              )}
            </View>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 13, color: '#2563EB', fontWeight: '600' }}>
              Rastrear →
            </Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default function App() {
  const [savedTags, setSavedTags] = useState<SavedTag[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Estados do Modal de Cadastro de Tag
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);
  const [registerStep, setRegisterStep] = useState<'searching' | 'found'>('searching');
  const [candidateTag, setCandidateTag] = useState<SavedTag | null>(null);
  const [newTagName, setNewTagName] = useState<string>('');
  const [newTagEmoji, setNewTagEmoji] = useState<string>('🎒');

  // Estados da Tela de Radar
  const [isEditingTag, setIsEditingTag] = useState<boolean>(false);
  const [tempName, setTempName] = useState<string>('');
  const [tempEmoji, setTempEmoji] = useState<string>('🏷️');
  const [rawRssi, setRawRssi] = useState<number | null>(null);
  const [smoothedRssi, setSmoothedRssi] = useState<number | null>(null);
  const [peakStrength, setPeakStrength] = useState<number>(0);
  const [trend, setTrend] = useState<'rising' | 'falling' | 'stable'>('stable');
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [isConnectedBle, setIsConnectedBle] = useState<boolean>(false);
  const [isRinging, setIsRinging] = useState<boolean>(false);
  const [hapticEnabled, setHapticEnabled] = useState<boolean>(true);
  const [radarStatus, setRadarStatus] = useState<string>('Pronto para localizar');
  const [audioChannelReady, setAudioChannelReady] = useState<boolean>(false);

  const emaRssiRef = useRef<number | null>(null);
  const pollingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const currentStrengthRef = useRef<number>(0);
  const activeDeviceRef = useRef<Device | null>(null);
  const isManualDisconnectRef = useRef<boolean>(false);
  const savedTagsRef = useRef<SavedTag[]>(savedTags);

  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    savedTagsRef.current = savedTags;
  }, [savedTags]);

  const selectedTag = savedTags.find((t) => t.deviceId === selectedDeviceId) || null;

  const getSignalStrength = (rssi: number | null): number => {
    if (rssi === null) return 0;
    const clamped = Math.max(MIN_RSSI, Math.min(MAX_RSSI, rssi));
    const normalized = (clamped - MIN_RSSI) / (MAX_RSSI - MIN_RSSI);
    return Math.round(Math.pow(normalized, CURVE_EXPONENT) * 100);
  };

  // Captura localização GPS do iPhone e converte em endereço legível
  const captureTagLocation = async (deviceId: string): Promise<TagCoords | undefined> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return undefined;

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords: TagCoords = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };

      const [place] = await Location.reverseGeocodeAsync(coords);

      let formattedAddress = `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
      if (place) {
        const street = [place.street, place.streetNumber].filter(Boolean).join(', ');
        const district = place.district || place.subregion || place.city || '';
        const composed = [street, district].filter(Boolean).join(' - ');
        if (composed) formattedAddress = composed;
      }

      setSavedTags((prev) =>
        prev.map((t) =>
          t.deviceId === deviceId
            ? {
                ...t,
                lastLocation: formattedAddress,
                lastCoords: coords,
                lastSeen: formatCurrentTime(),
              }
            : t
        )
      );

      return coords;
    } catch {
      // Ignora falhas temporárias de GPS
      return undefined;
    }
  };

  const openTagInMaps = (tag: SavedTag) => {
    if (!tag.lastCoords) {
      Alert.alert(
        'Sem localização salva',
        'Conecte na tag pelo menos uma vez com o GPS ativado para registrar o ponto no mapa.'
      );
      return;
    }

    const { latitude, longitude } = tag.lastCoords;
    const label = encodeURIComponent(`${tag.emoji} ${tag.name}`);
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?ll=${latitude},${longitude}&q=${label}`
        : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`;

    Linking.openURL(url).catch(() => {
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`);
    });
  };

  useEffect(() => {
    if (!isTracking) {
      pulseAnim.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1100,
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [isTracking, pulseAnim]);

  const resetFilter = () => {
    emaRssiRef.current = null;
    currentStrengthRef.current = 0;
    setSmoothedRssi(null);
    setRawRssi(null);
    setPeakStrength(0);
    setTrend('stable');
  };

  const updateRssiReading = (newRssi: number | null, deviceId?: string) => {
    if (newRssi === null || newRssi === 127) return;

    setRawRssi(newRssi);

    const alpha = 0.28;
    const prev = emaRssiRef.current;

    if (prev === null) {
      emaRssiRef.current = newRssi;
    } else {
      const next = prev + alpha * (newRssi - prev);
      emaRssiRef.current = next;

      const diff = next - prev;
      if (diff >= 0.8) {
        setTrend('rising');
      } else if (diff <= -0.8) {
        setTrend('falling');
      } else {
        setTrend('stable');
      }
    }

    const rounded = Math.round(emaRssiRef.current);
    const strengthNow = getSignalStrength(rounded);

    setSmoothedRssi(rounded);
    currentStrengthRef.current = strengthNow;
    setPeakStrength((prevPeak) => Math.max(prevPeak, strengthNow));

    if (deviceId) {
      setSavedTags((prevTags) =>
        prevTags.map((t) =>
          t.deviceId === deviceId
            ? { ...t, lastSeen: formatCurrentTime(), lastStrength: strengthNow }
            : t
        )
      );
    }
  };

  useEffect(() => {
    if (!isTracking || !hapticEnabled) return;

    let timerId: ReturnType<typeof setTimeout>;
    let active = true;

    const schedulePulse = () => {
      if (!active) return;

      const s = currentStrengthRef.current;
      let delay = 1500;

      if (s >= 85) delay = 200;
      else if (s >= 65) delay = 450;
      else if (s >= 45) delay = 850;
      else if (s >= 25) delay = 1400;

      if (s >= 25) {
        Vibration.vibrate(20);
      }

      timerId = setTimeout(schedulePulse, delay);
    };

    schedulePulse();

    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [isTracking, hapticEnabled]);

  const closeRegisterModal = () => {
    bleManager.stopDeviceScan();
    setIsRegisterModalOpen(false);
    setCandidateTag(null);
  };

  const openRegisterFlow = () => {
    setIsRegisterModalOpen(true);
    setRegisterStep('searching');
    setCandidateTag(null);
    setNewTagName('');
    setNewTagEmoji('🎒');

    let foundRealDevice = false;

    bleManager.startDeviceScan([SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        bleManager.stopDeviceScan();
        Alert.alert('Erro Bluetooth', error.message || 'Verifique se o Bluetooth está ligado.');
        closeRegisterModal();
        return;
      }

      if (device && !foundRealDevice) {
        foundRealDevice = true;
        bleManager.stopDeviceScan();

        const parsed = parseManufacturerData(device.manufacturerData);
        const hardwareId = parsed?.tagId || '01:02:03:04';
        const powerSource = parsed?.powerSource || 'USB';
        const strength = getSignalStrength(device.rssi) || 100;

        setCandidateTag({
          deviceId: device.id,
          hardwareId,
          name: device.name || 'KeepNear Tag',
          emoji: '🎒',
          powerSource,
          lastSeen: formatCurrentTime(),
          lastStrength: strength,
        });
        setNewTagName('Minha Tag');
        setRegisterStep('found');
      }
    });
  };

  const confirmTagRegistration = () => {
    if (!candidateTag) return;

    const finalTag: SavedTag = {
      ...candidateTag,
      name: newTagName.trim() || candidateTag.name,
      emoji: newTagEmoji || '🏷️',
      lastSeen: formatCurrentTime(),
    };

    setSavedTags((prev) => {
      const exists = prev.some((t) => t.deviceId === finalTag.deviceId);
      if (exists) {
        return prev.map((t) => (t.deviceId === finalTag.deviceId ? finalTag : t));
      }
      return [...prev, finalTag];
    });

    captureTagLocation(finalTag.deviceId);
    closeRegisterModal();
  };

  const stopConnectedRssiPolling = () => {
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
  };

  const startConnectedRssiPolling = (connectedDevice: Device) => {
    stopConnectedRssiPolling();
    pollingInterval.current = setInterval(async () => {
      try {
        const updatedDevice = await connectedDevice.readRSSI();
        updateRssiReading(updatedDevice.rssi, connectedDevice.id);
      } catch {
        // Ignora falhas pontuais de leitura
      }
    }, 200);
  };

  const triggerTagBuzzer = async () => {
    if (!selectedTag) return;

    if (!activeDeviceRef.current || !isConnectedBle) {
      Alert.alert(
        'Tag desconectada',
        'Toque em "Localizar Agora" primeiro para conectar na tag.'
      );
      return;
    }

    try {
      setIsRinging(true);
      await activeDeviceRef.current.discoverAllServicesAndCharacteristics();
      const characteristics = await activeDeviceRef.current.characteristicsForService(SERVICE_UUID);
      const buzzerChar = characteristics.find(
        (c) => c.uuid.toLowerCase() === BUZZER_CHAR_UUID.toLowerCase()
      );

      if (!buzzerChar) {
        Alert.alert(
          'Canal de som ausente',
          'Desative e ative o Bluetooth nos Ajustes do iPhone para limpar o cache e reconecte.'
        );
        return;
      }

      if (buzzerChar.isWritableWithResponse) {
        await buzzerChar.writeWithResponse(BUZZER_TRIGGER_BASE64);
      } else {
        await buzzerChar.writeWithoutResponse(BUZZER_TRIGGER_BASE64);
      }
    } catch (err: any) {
      Alert.alert('Erro ao tocar som', err?.message || 'Falha na transmissão Bluetooth.');
    } finally {
      setTimeout(() => setIsRinging(false), 1800);
    }
  };

  const startRadarTracking = (targetTag: SavedTag) => {
    resetFilter();
    setIsTracking(true);
    setIsConnectedBle(false);
    setAudioChannelReady(false);
    isConnectingRef.current = false;
    isManualDisconnectRef.current = false;

    setRadarStatus('Buscando sinal da tag...');
    bleManager.startDeviceScan([SERVICE_UUID], { allowDuplicates: true }, async (error, device) => {
      if (error) {
        setRadarStatus('Erro ao iniciar Bluetooth');
        setIsTracking(false);
        return;
      }

      if (device && device.id === targetTag.deviceId && !isConnectingRef.current) {
        isConnectingRef.current = true;
        bleManager.stopDeviceScan();

        updateRssiReading(device.rssi, device.id);
        setRadarStatus('Conectando leitura contínua...');

        try {
          const connectedDevice = await bleManager.connectToDevice(device.id);
          await connectedDevice.discoverAllServicesAndCharacteristics();
          activeDeviceRef.current = connectedDevice;
          setIsConnectedBle(true);

          // Registra a localização GPS atual do iPhone ao conectar na tag
          captureTagLocation(device.id);

          const chars = await connectedDevice.characteristicsForService(SERVICE_UUID);
          const hasBuzzer = chars.some(
            (c) => c.uuid.toLowerCase() === BUZZER_CHAR_UUID.toLowerCase()
          );
          setAudioChannelReady(hasBuzzer);

          setRadarStatus('Rastreando em tempo real');
          startConnectedRssiPolling(connectedDevice);

          connectedDevice.onDisconnected(async () => {
            const wasManual = isManualDisconnectRef.current;
            isManualDisconnectRef.current = false;

            stopConnectedRssiPolling();
            isConnectingRef.current = false;
            setIsTracking(false);
            setIsConnectedBle(false);
            setAudioChannelReady(false);
            activeDeviceRef.current = null;

            // Salva a última localização conhecida no momento em que a tag ficou para trás
            const latestCoords = await captureTagLocation(device.id);

            if (wasManual) {
              setRadarStatus('Rastreamento pausado');
              return;
            }

            setRadarStatus('⚠️ Sinal perdido • Último local salvo');
            Vibration.vibrate([0, 400, 150, 400]);

            const currentTag =
              savedTagsRef.current.find((t) => t.deviceId === device.id) || targetTag;
            const tagWithFreshCoords: SavedTag = latestCoords
              ? { ...currentTag, lastCoords: latestCoords }
              : currentTag;

            Alert.alert(
              '⚠️ Você esqueceu sua tag!',
              `A conexão com "${currentTag.emoji} ${currentTag.name}" foi perdida por queda de sinal ou afastamento. A última localização foi salva.`,
              [
                ...(tagWithFreshCoords.lastCoords
                  ? [
                      {
                        text: 'Ver no Mapa',
                        onPress: () => openTagInMaps(tagWithFreshCoords),
                      },
                    ]
                  : []),
                { text: 'OK', style: 'cancel' },
              ]
            );
          });
        } catch {
          isConnectingRef.current = false;
          setIsTracking(false);
          setIsConnectedBle(false);
          setAudioChannelReady(false);
          setRadarStatus('Falha ao conectar na tag');
        }
      }
    });
  };

  const stopRadarTracking = async () => {
    isManualDisconnectRef.current = true;
    bleManager.stopDeviceScan();
    stopConnectedRssiPolling();
    isConnectingRef.current = false;
    setIsTracking(false);
    setIsConnectedBle(false);
    setAudioChannelReady(false);

    if (activeDeviceRef.current) {
      const devId = activeDeviceRef.current.id;
      captureTagLocation(devId);
      try {
        await bleManager.cancelDeviceConnection(devId);
      } catch {
        // Ignora se já desconectado
      }
      activeDeviceRef.current = null;
    }

    setRadarStatus('Rastreamento pausado');
  };

  const openTagRadar = (item: SavedTag) => {
    resetFilter();
    setSelectedDeviceId(item.deviceId);
    setTempName(item.name);
    setTempEmoji(item.emoji || '🏷️');
    setIsEditingTag(false);
    setRadarStatus(`Visto por último às ${item.lastSeen}`);
  };

  const backToTagList = async () => {
    await stopRadarTracking();
    setSelectedDeviceId(null);
  };

  const saveTagDetails = () => {
    if (!selectedTag) return;
    setSavedTags((prev) =>
      prev.map((t) =>
        t.deviceId === selectedTag.deviceId
          ? {
              ...t,
              name: tempName.trim() || t.name,
              emoji: tempEmoji || t.emoji,
            }
          : t
      )
    );
    setIsEditingTag(false);
  };

  const deleteTagById = (targetId: string) => {
    setSavedTags((prev) => prev.filter((t) => t.deviceId !== targetId));
  };

  useEffect(() => {
    return () => {
      bleManager.stopDeviceScan();
      stopConnectedRssiPolling();
      bleManager.destroy();
    };
  }, []);

  const getSignalInfo = (strength: number, hasSignal: boolean) => {
    if (!hasSignal) return { label: 'Aguardando...', color: '#6B7280' };
    if (strength >= 85) return { label: 'Excelente', color: '#16A34A' };
    if (strength >= 65) return { label: 'Forte', color: '#16A34A' };
    if (strength >= 45) return { label: 'Média', color: '#2563EB' };
    if (strength >= 25) return { label: 'Fraca', color: '#D97706' };
    return { label: 'Muito Fraca', color: '#DC2626' };
  };

  const getTrendBadge = () => {
    if (trend === 'rising') {
      return { text: '↑ Sinal aumentando', color: '#16A34A', bg: '#DCFCE7' };
    }
    if (trend === 'falling') {
      return { text: '↓ Sinal diminuindo', color: '#DC2626', bg: '#FEE2E2' };
    }
    return { text: '• Sinal estável', color: '#4B5563', bg: '#F3F4F6' };
  };

  // ==========================================
  // TELA 2: RADAR DE PROXIMIDADE DA TAG
  // ==========================================
  if (selectedTag) {
    const strength = getSignalStrength(smoothedRssi);
    const signalInfo = getSignalInfo(strength, smoothedRssi !== null);
    const trendBadge = getTrendBadge();

    const outerScale = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.95, 1.08],
    });

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, paddingHorizontal: 24, paddingVertical: 16 }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <TouchableOpacity
              onPress={backToTagList}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: '#F3F4F6',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827' }}>← Meus Itens</Text>
            </TouchableOpacity>

            {selectedTag.lastCoords && (
              <TouchableOpacity
                onPress={() => openTagInMaps(selectedTag)}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: '#EFF6FF',
                  borderWidth: 1,
                  borderColor: '#BFDBFE',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#2563EB' }}>
                  📍 Ver no Mapa
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={{ fontSize: 14, color: '#6B7280', marginBottom: 12 }}>{radarStatus}</Text>

            <View
              style={{
                alignItems: 'center',
                marginBottom: 16,
                padding: 22,
                borderRadius: 24,
                backgroundColor: '#F9FAFB',
                width: '100%',
                borderWidth: 1,
                borderColor: '#E5E7EB',
              }}
            >
              {isEditingTag ? (
                <View style={{ width: '100%', marginBottom: 10 }}>
                  <EmojiSelector selectedEmoji={tempEmoji} onSelect={setTempEmoji} />

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <TextInput
                      value={tempName}
                      onChangeText={setTempName}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={saveTagDetails}
                      style={{
                        flex: 1,
                        borderBottomWidth: 1.5,
                        borderColor: '#2563EB',
                        fontSize: 18,
                        fontWeight: '700',
                        color: '#111827',
                        paddingVertical: 4,
                      }}
                    />
                    <TouchableOpacity
                      onPress={saveTagDetails}
                      style={{
                        backgroundColor: '#2563EB',
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 10,
                      }}
                    >
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
                        Salvar
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    setTempName(selectedTag.name);
                    setTempEmoji(selectedTag.emoji || '🏷️');
                    setIsEditingTag(true);
                  }}
                  style={{ alignItems: 'center', marginBottom: 4 }}
                >
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      backgroundColor: '#FFFFFF',
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      justifyContent: 'center',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>{selectedTag.emoji || '🏷️'}</Text>
                  </View>
                  <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827' }}>
                    {selectedTag.name} ✎
                  </Text>
                </TouchableOpacity>
              )}

              <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>
                ID {selectedTag.hardwareId} • Energia: {selectedTag.powerSource}
              </Text>

              {selectedTag.lastLocation && (
                <TouchableOpacity
                  onPress={() => openTagInMaps(selectedTag)}
                  style={{
                    backgroundColor: '#FFFFFF',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                    marginBottom: 16,
                  }}
                >
                  <Text style={{ fontSize: 12, color: '#374151', textAlign: 'center' }}>
                    📍 {selectedTag.lastLocation}
                  </Text>
                </TouchableOpacity>
              )}

              <Animated.View
                style={{
                  width: 164,
                  height: 164,
                  borderRadius: 82,
                  borderWidth: 2,
                  borderColor: strength >= 30 ? `${signalInfo.color}33` : '#E5E7EB',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: 16,
                  transform: [{ scale: isTracking ? outerScale : 1 }],
                }}
              >
                <View
                  style={{
                    width: 122,
                    height: 122,
                    borderRadius: 61,
                    borderWidth: 2,
                    borderColor: strength >= 60 ? `${signalInfo.color}66` : '#E5E7EB',
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  <Text style={{ fontSize: 38, fontWeight: 'bold', color: '#111827' }}>
                    {smoothedRssi !== null ? `${strength}%` : '--'}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: signalInfo.color }}>
                    {signalInfo.label}
                  </Text>
                </View>
              </Animated.View>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <View
                  style={{
                    backgroundColor: trendBadge.bg,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: trendBadge.color }}>
                    {trendBadge.text}
                  </Text>
                </View>

                <View
                  style={{
                    backgroundColor: '#F3F4F6',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151' }}>
                    Pico: {peakStrength}%
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setHapticEnabled(!hapticEnabled)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 9,
                  borderRadius: 10,
                  backgroundColor: hapticEnabled ? '#111827' : '#E5E7EB',
                  marginBottom: 10,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: hapticEnabled ? '#FFFFFF' : '#374151',
                  }}
                >
                  {hapticEnabled ? 'Pulso Tátil: Ativado' : 'Pulso Tátil: Desativado'}
                </Text>
              </TouchableOpacity>

              <Text style={{ fontSize: 12, color: '#9CA3AF' }}>
                RSSI: {smoothedRssi !== null ? `${smoothedRssi} dBm` : '--'} (Bruto: {rawRssi ?? '--'})
              </Text>
              {isConnectedBle && (
                <Text
                  style={{
                    fontSize: 11,
                    color: audioChannelReady ? '#16A34A' : '#D97706',
                    marginTop: 4,
                    fontWeight: '600',
                  }}
                >
                  {audioChannelReady
                    ? '✓ Canal de áudio da tag sincronizado'
                    : '⚠ Reinicie o Bluetooth nos Ajustes do iPhone'}
                </Text>
              )}
            </View>

            <TouchableOpacity
              onPress={triggerTagBuzzer}
              disabled={!isConnectedBle}
              style={{
                backgroundColor: isConnectedBle ? (isRinging ? '#059669' : '#111827') : '#E5E7EB',
                paddingVertical: 14,
                borderRadius: 14,
                alignItems: 'center',
                width: '100%',
                marginBottom: 10,
              }}
            >
              <Text
                style={{
                  color: isConnectedBle ? '#FFFFFF' : '#9CA3AF',
                  fontSize: 15,
                  fontWeight: '600',
                }}
              >
                {isRinging ? '🔊 Tocando Som na Tag...' : '🔔 Tocar Som na Tag'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={isTracking ? stopRadarTracking : () => startRadarTracking(selectedTag)}
              style={{
                backgroundColor: isTracking ? '#6B7280' : '#2563EB',
                paddingVertical: 16,
                borderRadius: 14,
                alignItems: 'center',
                width: '100%',
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                {isTracking ? 'Encerrar Rastreamento' : 'Localizar Agora'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ==========================================
  // TELA 1: LISTA DE TAGS E MODAL DE CADASTRO
  // ==========================================
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingVertical: 16 }}>
        <View style={{ marginTop: 8, marginBottom: 20 }}>
          <Text style={{ fontSize: 28, fontWeight: 'bold', color: '#111827' }}>KeepNear</Text>
          <Text style={{ fontSize: 14, color: '#6B7280', marginTop: 2 }}>
            {savedTags.length > 0
              ? 'Arraste uma tag para a direita para excluir'
              : 'Cadastre sua primeira tag Bluetooth'}
          </Text>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>
          {savedTags.length === 0 ? (
            <View
              style={{
                padding: 32,
                borderRadius: 20,
                backgroundColor: '#F9FAFB',
                borderWidth: 1,
                borderColor: '#E5E7EB',
                alignItems: 'center',
                marginTop: 20,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 6 }}>
                Nenhuma tag cadastrada
              </Text>
              <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center' }}>
                Toque no botão abaixo para buscar e parear sua tag ESP32 KeepNear.
              </Text>
            </View>
          ) : (
            savedTags.map((item) => (
              <SwipeableTagCard
                key={item.deviceId}
                item={item}
                onPress={() => openTagRadar(item)}
                onDeleteRequest={() => deleteTagById(item.deviceId)}
              />
            ))
          )}
        </ScrollView>

        <TouchableOpacity
          onPress={openRegisterFlow}
          style={{
            backgroundColor: '#2563EB',
            paddingVertical: 16,
            borderRadius: 14,
            alignItems: 'center',
            marginTop: 16,
            marginBottom: 8,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
            + Cadastrar Nova Tag
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={isRegisterModalOpen}
        animationType="slide"
        transparent
        onRequestClose={closeRegisterModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{
            flex: 1,
            backgroundColor: 'rgba(17, 24, 39, 0.5)',
            justifyContent: 'flex-end',
          }}
        >
          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: 36,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827' }}>
                Cadastrar Tag
              </Text>
              <TouchableOpacity onPress={closeRegisterModal}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#6B7280' }}>Cancelar</Text>
              </TouchableOpacity>
            </View>

            {registerStep === 'searching' ? (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <ActivityIndicator size="large" color="#2563EB" style={{ marginBottom: 16 }} />
                <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 6 }}>
                  Buscando tag KeepNear real...
                </Text>
                <Text style={{ fontSize: 13, color: '#6B7280', textAlign: 'center' }}>
                  Mantenha o ESP32-C6 ligado próximo ao iPhone.
                </Text>
              </View>
            ) : (
              candidateTag && (
                <View>
                  <View
                    style={{
                      padding: 16,
                      borderRadius: 16,
                      backgroundColor: '#F0FDF4',
                      borderWidth: 1,
                      borderColor: '#BBF7D0',
                      marginBottom: 16,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#16A34A' }}>
                      ✓ Tag KeepNear identificada
                    </Text>
                    <Text style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
                      ID do Hardware: {candidateTag.hardwareId} • Sinal: {candidateTag.lastStrength}%
                    </Text>
                  </View>

                  <EmojiSelector selectedEmoji={newTagEmoji} onSelect={setNewTagEmoji} />

                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 }}>
                    Nome do objeto
                  </Text>
                  <TextInput
                    value={newTagName}
                    onChangeText={setNewTagName}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={confirmTagRegistration}
                    placeholder="Ex: Chaves, Mochila, Carteira..."
                    style={{
                      borderWidth: 1,
                      borderColor: '#D1D5DB',
                      borderRadius: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      fontSize: 16,
                      color: '#111827',
                      marginBottom: 20,
                    }}
                  />

                  <TouchableOpacity
                    onPress={confirmTagRegistration}
                    style={{
                      backgroundColor: '#16A34A',
                      paddingVertical: 15,
                      borderRadius: 14,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
                      Concluir Cadastro
                    </Text>
                  </TouchableOpacity>
                </View>
              )
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

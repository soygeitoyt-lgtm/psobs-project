import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioDeviceOption, AudioSettings } from '../types';

export function useAudioCapture() {
  const [devices, setDevices] = useState<AudioDeviceOption[]>([]);
  const [settings, setSettings] = useState<AudioSettings>({
    deviceId: '',
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    gain: 1.0,
    stereo: false,
  });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [testLocally, setTestLocally] = useState(false);
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const localMonitorNodeRef = useRef<GainNode | null>(null);
  const destinationNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);

  // Fetch available audio input devices
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        setError('El navegador no soporta enumeración de dispositivos de audio.');
        return;
      }
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter((d) => d.kind === 'audioinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Micrófono ${index + 1}`,
        }));

      setDevices(audioInputs);
      if (audioInputs.length > 0 && !settings.deviceId) {
        setSettings((prev) => ({
          ...prev,
          deviceId: audioInputs[0].deviceId,
        }));
      }
    } catch (err: unknown) {
      console.warn('Error al listar dispositivos:', err);
    }
  }, [settings.deviceId]);

  // Initial device list and change listener
  useEffect(() => {
    refreshDevices();

    const handleDeviceChange = () => {
      refreshDevices();
    };

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  // Handle Gain adjustments in real-time
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(
        isMuted ? 0 : settings.gain,
        audioContextRef.current?.currentTime || 0,
        0.05
      );
    }
  }, [settings.gain, isMuted]);

  // Handle local monitoring (hearing yourself in headphones)
  useEffect(() => {
    if (localMonitorNodeRef.current && audioContextRef.current) {
      localMonitorNodeRef.current.gain.setTargetAtTime(
        testLocally ? 1.0 : 0.0,
        audioContextRef.current.currentTime,
        0.05
      );
    }
  }, [testLocally]);

  // Start microphone capture with chosen settings
  const startCapture = useCallback(async () => {
    setError(null);
    try {
      // Stop any existing streams
      if (rawStreamRef.current) {
        rawStreamRef.current.getTracks().forEach((track) => track.stop());
        rawStreamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }

      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: settings.deviceId ? { ideal: settings.deviceId } : undefined,
          echoCancellation: { ideal: settings.echoCancellation },
          noiseSuppression: { ideal: settings.noiseSuppression },
          autoGainControl: { ideal: settings.autoGainControl },
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: settings.stereo ? 2 : 1 },
        },
        video: false,
      };

      const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
      rawStreamRef.current = rawStream;
      setPermissionState('granted');

      // Ensure tracks match initial mute state
      rawStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });

      // Update device labels if they were blank before permission
      refreshDevices();

      // Create Web Audio processing pipeline for VU meter
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;

      // On mobile browsers, AudioContext starts suspended until resumed explicitly
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }

      const source = ctx.createMediaStreamSource(rawStream);
      sourceNodeRef.current = source;

      const gain = ctx.createGain();
      gain.gain.value = isMuted ? 0 : settings.gain;
      gainNodeRef.current = gain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      analyserNodeRef.current = analyser;

      // Connect source to gain and analyser for VU meter
      source.connect(gain);
      gain.connect(analyser);

      // Local monitor node (connected to speakers/headphones if testLocally is on)
      const monitorGain = ctx.createGain();
      monitorGain.gain.value = testLocally ? 1.0 : 0.0;
      localMonitorNodeRef.current = monitorGain;
      gain.connect(monitorGain);
      monitorGain.connect(ctx.destination);

      // We transmit the native rawStream directly over WebRTC.
      // This ensures 100% hardware audio transmission with zero AudioContext suspension dropouts.
      processedStreamRef.current = rawStream;
      setStream(rawStream);
      setIsCapturing(true);

      // Start volume level loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!analyserNodeRef.current) return;
        analyserNodeRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        // Map 0-255 to percentage 0-100 with non-linear curve for natural decibel feel
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setVolumeLevel(isMuted ? 0 : normalized);

        animFrameRef.current = requestAnimationFrame(updateVolume);
      };
      animFrameRef.current = requestAnimationFrame(updateVolume);

      return rawStream;
    } catch (err: unknown) {
      console.error('Error al acceder al micrófono:', err);
      const msg =
        err instanceof Error
          ? err.message
          : 'No se pudo acceder al micrófono seleccionado.';
      setError(msg);
      setPermissionState('denied');
      setIsCapturing(false);
      return null;
    }
  }, [settings, isMuted, testLocally, refreshDevices]);

  // Stop capture
  const stopCapture = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach((track) => track.stop());
      rawStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setStream(null);
    setIsCapturing(false);
    setVolumeLevel(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (rawStreamRef.current) {
        rawStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = !next;
        });
      }
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(
          next ? 0 : settings.gain,
          audioContextRef.current.currentTime,
          0.02
        );
      }
      return next;
    });
  }, [settings.gain]);

  const updateSetting = useCallback(<K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return {
    devices,
    settings,
    updateSetting,
    stream,
    isCapturing,
    isMuted,
    toggleMute,
    volumeLevel,
    testLocally,
    setTestLocally,
    permissionState,
    error,
    refreshDevices,
    startCapture,
    stopCapture,
  };
}

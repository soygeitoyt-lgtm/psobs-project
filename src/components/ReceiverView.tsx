import { useEffect, useRef, useState, useMemo } from 'react';
import {
  Volume2,
  VolumeX,
  Radio,
  RefreshCw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Play,
  Share2,
  HelpCircle,
  Copy,
  Check,
} from 'lucide-react';
import { useWebRTC } from '../hooks/useWebRTC';
import { AudioMeter } from './AudioMeter';
import { ObsInstructionsModal } from './ObsInstructionsModal';

interface ReceiverViewProps {
  room: string;
  onRoomChange?: (newRoom: string) => void;
  onSwitchToSender?: () => void;
}

export function ReceiverView({
  room,
  onRoomChange,
  onSwitchToSender,
}: ReceiverViewProps) {
  const [volume, setVolume] = useState(1.0);
  const [isAudioContextBlocked, setIsAudioContextBlocked] = useState(false);
  const [remoteVolumeLevel, setRemoteVolumeLevel] = useState(0);
  const [widgetMode, setWidgetMode] = useState<'hud' | 'full' | 'stealth'>('hud');
  const [showInstructions, setShowInstructions] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isPlayingTestTone, setIsPlayingTestTone] = useState(false);

  // WebRTC hook as receiver
  const {
    status,
    remoteStream,
    connectedPeersCount,
    remoteMuted,
    errorMessage,
    pingLatency,
    reconnect,
  } = useWebRTC({
    room,
    role: 'receiver',
    localStream: null,
    deviceName: 'OBS Studio Browser Source',
  });

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const volumeRef = useRef<number>(volume);
  const remoteMutedRef = useRef<boolean>(remoteMuted);

  // Sync volume ref
  useEffect(() => {
    volumeRef.current = volume;
    if (audioElRef.current) {
      audioElRef.current.volume = volume;
    }
  }, [volume]);

  // Sync mute ref
  useEffect(() => {
    remoteMutedRef.current = remoteMuted;
  }, [remoteMuted]);

  // Attach remote stream to <audio> and Web Audio Analyser for VU Meter
  useEffect(() => {
    if (!remoteStream) {
      if (audioElRef.current) {
        audioElRef.current.srcObject = null;
      }
      setRemoteVolumeLevel(0);
      return;
    }

    const audioEl = audioElRef.current;
    if (audioEl) {
      audioEl.srcObject = remoteStream;
      audioEl.volume = volumeRef.current;
      audioEl.muted = false;
      const playPromise = audioEl.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsAudioContextBlocked(false);
          })
          .catch((err) => {
            console.warn('Autoplay blocked by browser policy:', err);
            setIsAudioContextBlocked(true);
          });
      }
    }

    // Set up AudioContext for VU meter visualization
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const source = ctx.createMediaStreamSource(remoteStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      analyserRef.current = analyser;

      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));
        setRemoteVolumeLevel(remoteMutedRef.current ? 0 : normalized);

        animFrameRef.current = requestAnimationFrame(updateMeter);
      };

      animFrameRef.current = requestAnimationFrame(updateMeter);
    } catch (e) {
      console.warn('Could not initialize receiver AudioContext:', e);
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [remoteStream]);

  // Volume slider update
  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
  };

  // Resume audio when user clicks manual play or interacts with page
  const handleManualPlay = () => {
    if (audioElRef.current) {
      audioElRef.current.play().then(() => {
        setIsAudioContextBlocked(false);
      }).catch(() => {});
    }
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  };

  // Global user interaction listener to unblock audio in browsers
  useEffect(() => {
    const handleUnlock = () => {
      if (audioElRef.current && audioElRef.current.srcObject && audioElRef.current.paused) {
        audioElRef.current.play().then(() => setIsAudioContextBlocked(false)).catch(() => {});
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    };

    window.addEventListener('click', handleUnlock);
    window.addEventListener('touchstart', handleUnlock);
    window.addEventListener('keydown', handleUnlock);
    return () => {
      window.removeEventListener('click', handleUnlock);
      window.removeEventListener('touchstart', handleUnlock);
      window.removeEventListener('keydown', handleUnlock);
    };
  }, []);

  // Audio test tone (useful for verifying OBS Audio Mixer is picking up browser sound)
  const playTestTone = () => {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx =
        audioCtxRef.current && audioCtxRef.current.state !== 'closed'
          ? audioCtxRef.current
          : new AudioContextClass();

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      setIsPlayingTestTone(true);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880.0, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.25 * volumeRef.current, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.4);

      setTimeout(() => {
        setIsPlayingTestTone(false);
      }, 450);
    } catch (e) {
      console.warn('Error playing test tone:', e);
      setIsPlayingTestTone(false);
    }
  };

  const obsUrl = useMemo(() => {
    return `${window.location.origin}/?role=obs&room=${encodeURIComponent(room)}`;
  }, [room]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(obsUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  // Stealth mode: pure transparent audio receiver with tiny watermark
  if (widgetMode === 'stealth') {
    return (
      <div className="fixed inset-0 flex flex-col justify-end p-2 bg-transparent pointer-events-none select-none">
        <audio ref={audioElRef} autoPlay playsInline />
        <div className="flex items-center gap-2 text-[10px] text-zinc-500/60 font-mono">
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'connected' ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'
            }`}
          />
          <span>OBS MIC • {room}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`w-full ${
        widgetMode === 'hud'
          ? 'max-w-md mx-auto p-3'
          : 'max-w-2xl mx-auto p-4'
      } space-y-3 animate-in fade-in duration-150`}
      id="receiver-view-container"
    >
      {/* Hidden audio element for streaming */}
      <audio ref={audioElRef} autoPlay playsInline />

      {/* Autoplay blocked banner (if opened in normal browser instead of OBS) */}
      {isAudioContextBlocked && (
        <div className="p-3 bg-amber-500/20 border border-amber-500/40 rounded-xl text-xs text-amber-200 flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>El navegador pausó el audio. Pulsa reproducir para escucharlo:</span>
          </div>
          <button
            id="btn-unblock-audio"
            onClick={handleManualPlay}
            className="flex items-center gap-1.5 px-3 py-1 bg-amber-500 text-zinc-950 font-bold rounded-lg text-xs hover:bg-amber-400 transition"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Activar</span>
          </button>
        </div>
      )}

      {/* Main Broadcast Widget Card */}
      <div
        className={`relative overflow-hidden rounded-2xl border transition-all ${
          widgetMode === 'hud'
            ? 'bg-zinc-900/90 backdrop-blur-md border-zinc-800 shadow-2xl p-4'
            : 'bg-zinc-900 border-zinc-800 p-5 shadow-xl space-y-4'
        }`}
      >
        {/* Top Header: Badge + Room Name */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                status === 'connected'
                  ? remoteMuted
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              <Radio
                className={`w-3.5 h-3.5 ${
                  status === 'connected' && !remoteMuted ? 'animate-pulse text-emerald-400' : ''
                }`}
              />
              <span>
                {status === 'connected'
                  ? remoteMuted
                    ? 'MIC MUDO'
                    : 'MIC EN VIVO'
                  : 'OBS ESPERANDO...'}
              </span>
            </span>

            <span className="text-xs text-zinc-400 font-mono">
              Sala: <strong className="text-zinc-200">{room}</strong>
            </span>
          </div>

          {/* View Mode Pills */}
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-[11px]">
            <button
              onClick={() => setWidgetMode('hud')}
              className={`px-2 py-0.5 rounded-md font-medium transition ${
                widgetMode === 'hud'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Widget compacto para overlay de stream"
            >
              Widget
            </button>
            <button
              onClick={() => setWidgetMode('full')}
              className={`px-2 py-0.5 rounded-md font-medium transition ${
                widgetMode === 'full'
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Panel técnico completo"
            >
              Panel
            </button>
            <button
              onClick={() => setWidgetMode('stealth')}
              className="px-2 py-0.5 rounded-md font-medium text-zinc-400 hover:text-zinc-200 transition"
              title="Modo audio invisible / transparente"
            >
              Fondo Transparente
            </button>
          </div>
        </div>

        {/* Live EQ / Waveform Visualizer */}
        <div className="space-y-2 py-2">
          <AudioMeter
            level={remoteVolumeLevel}
            isMuted={remoteMuted}
            label={status === 'connected' ? 'Señal de Audio Recibida (OBS)' : 'Nivel de Audio (Esperando transmisión)'}
            compact={widgetMode === 'hud'}
          />
        </div>

        {/* Status description */}
        <div className="flex items-center justify-between text-xs text-zinc-400 pt-1 border-t border-zinc-800/80">
          <div className="flex items-center gap-1.5">
            {status === 'connected' ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">
                  {remoteMuted
                    ? 'El emisor ha silenciado su micrófono'
                    : 'Transmisión fluida hacia OBS activa'}
                </span>
              </>
            ) : status === 'waiting-peer' ? (
              <span className="text-amber-400">
                Abre la web en tu móvil e inicia "Transmitir Audio".
              </span>
            ) : (
              <span>Conectando con el servidor ({status})...</span>
            )}
          </div>

          {pingLatency !== null && (
            <span className="font-mono text-[11px] text-zinc-400">
              {pingLatency} ms
            </span>
          )}
        </div>

        {/* Full mode controls */}
        {widgetMode === 'full' && (
          <div className="pt-3 border-t border-zinc-800 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 flex-1">
                {volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-zinc-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                )}
                <span className="text-xs text-zinc-300 font-medium">Volumen local:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-32 accent-emerald-500 cursor-pointer"
                />
                <span className="font-mono text-xs text-zinc-400">{Math.round(volume * 100)}%</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  id="btn-test-sound-receiver"
                  onClick={playTestTone}
                  disabled={isPlayingTestTone}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-medium transition"
                  title="Reproduce un tono de prueba para confirmar que OBS recibe audio en su Mezclador"
                >
                  <Volume2 className={`w-3.5 h-3.5 ${isPlayingTestTone ? 'animate-bounce' : ''}`} />
                  <span>{isPlayingTestTone ? 'Probando...' : 'Probar Audio'}</span>
                </button>

                <button
                  id="btn-reconnect-receiver"
                  onClick={reconnect}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reconectar</span>
                </button>
              </div>
            </div>

            {/* Quick Share / Link Box for OBS */}
            <div className="flex items-center justify-between p-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs">
              <span className="text-zinc-400 truncate max-w-[280px] font-mono">
                {obsUrl}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 font-medium transition"
                >
                  {copiedLink ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedLink ? 'Copiado' : 'Copiar'}</span>
                </button>
                <button
                  onClick={() => setShowInstructions(true)}
                  className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 font-medium transition"
                >
                  <HelpCircle className="w-3 h-3 text-emerald-400" />
                  <span>Ayuda OBS</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Switch to mobile transmitter button if opened on phone by mistake */}
      {onSwitchToSender && (
        <div className="text-center pt-2">
          <button
            id="btn-switch-to-sender"
            onClick={onSwitchToSender}
            className="text-xs text-zinc-400 hover:text-emerald-400 transition underline underline-offset-2"
          >
            ¿Estás en tu celular y quieres transmitir tu voz? Cambia al modo Emisor aquí
          </button>
        </div>
      )}

      {/* Instructions Modal */}
      <ObsInstructionsModal
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
        obsUrl={obsUrl}
      />
    </div>
  );
}

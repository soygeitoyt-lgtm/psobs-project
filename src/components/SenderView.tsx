import { useState, useMemo } from 'react';
import {
  Mic,
  MicOff,
  Radio,
  RadioTower,
  Settings2,
  Copy,
  Check,
  QrCode,
  HelpCircle,
  RefreshCw,
  Sliders,
  Volume2,
  Headphones,
  ExternalLink,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useWebRTC } from '../hooks/useWebRTC';
import { AudioMeter } from './AudioMeter';
import { QRCodeModal } from './QRCodeModal';
import { ObsInstructionsModal } from './ObsInstructionsModal';

interface SenderViewProps {
  room: string;
  onRoomChange: (newRoom: string) => void;
  onSwitchToReceiver: () => void;
}

export function SenderView({ room, onRoomChange, onSwitchToReceiver }: SenderViewProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [roomInput, setRoomInput] = useState(room);
  const [isEditingRoom, setIsEditingRoom] = useState(false);

  // Audio capture hook
  const {
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
    error: audioError,
    refreshDevices,
    startCapture,
    stopCapture,
  } = useAudioCapture();

  // WebRTC hook
  const {
    status: rtcStatus,
    connectedPeersCount,
    errorMessage: rtcError,
    pingLatency,
  } = useWebRTC({
    room,
    role: 'sender',
    localStream: stream,
    deviceName: devices.find((d) => d.deviceId === settings.deviceId)?.label || 'Micrófono Móvil',
    isMuted,
  });

  // Calculate OBS Browser Source URL
  const obsUrl = useMemo(() => {
    const origin = window.location.origin;
    return `${origin}/?role=obs&room=${encodeURIComponent(room)}`;
  }, [room]);

  const handleCopyObsLink = async () => {
    try {
      await navigator.clipboard.writeText(obsUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = obsUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleToggleBroadcast = async () => {
    if (isCapturing) {
      stopCapture();
    } else {
      await startCapture();
    }
  };

  const handleSaveRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = roomInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (clean) {
      onRoomChange(clean);
      setIsEditingRoom(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-4 px-3 sm:px-4 py-4" id="sender-view-container">
      {/* Top Banner: Status & Quick Role Switch */}
      <div className="flex items-center justify-between bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <span
              className={`block w-3 h-3 rounded-full ${
                isCapturing
                  ? connectedPeersCount > 0
                    ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]'
                    : 'bg-amber-400 animate-pulse'
                  : 'bg-zinc-600'
              }`}
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-white">
              {isCapturing
                ? connectedPeersCount > 0
                  ? `Transmitiendo a OBS (${connectedPeersCount} conectado${connectedPeersCount > 1 ? 's' : ''})`
                  : 'Transmitiendo • Esperando a OBS...'
                : 'Transmisor Listo'}
            </p>
            <p className="text-[11px] text-zinc-400">
              {isCapturing
                ? connectedPeersCount > 0
                  ? `Latencia señal: ${pingLatency ? `${pingLatency}ms` : 'óptima'}`
                  : 'Añade el enlace en OBS para recibir el audio'
                : 'Selecciona micrófono y pulsa Transmitir'}
            </p>
          </div>
        </div>

        <button
          id="btn-help-obs"
          onClick={() => setShowInstructions(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 rounded-lg px-2.5 py-1.5 transition"
        >
          <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Guía OBS</span>
        </button>
      </div>

      {/* Main Stream Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-5 shadow-xl">
        {/* Room Header & Share Box */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Enlace de tu Micrófono para OBS
            </span>
            {isEditingRoom ? (
              <form onSubmit={handleSaveRoom} className="flex items-center gap-1">
                <input
                  type="text"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  className="px-2 py-0.5 text-xs bg-zinc-950 border border-emerald-500 rounded text-white font-mono w-28 focus:outline-hidden"
                  autoFocus
                />
                <button
                  type="submit"
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-medium px-1.5"
                >
                  OK
                </button>
              </form>
            ) : (
              <button
                id="btn-edit-room"
                onClick={() => {
                  setRoomInput(room);
                  setIsEditingRoom(true);
                }}
                className="text-[11px] text-zinc-400 hover:text-white font-mono bg-zinc-800 px-2 py-0.5 rounded transition"
              >
                Sala: <span className="text-emerald-400 font-semibold">{room}</span> (cambiar)
              </button>
            )}
          </div>

          {/* Copyable Link Card */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 bg-zinc-950 border border-zinc-800/90 rounded-xl">
            <div className="flex-1 flex items-center gap-2 min-w-0 px-1">
              <RadioTower className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <input
                type="text"
                readOnly
                value={obsUrl}
                className="w-full bg-transparent text-xs text-zinc-300 font-mono focus:outline-hidden truncate"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                id="btn-copy-obs-link"
                onClick={handleCopyObsLink}
                className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  copiedLink
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar Enlace</span>
                  </>
                )}
              </button>

              <button
                id="btn-open-qr-modal"
                onClick={() => setShowQrModal(true)}
                className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg transition"
                title="Mostrar código QR para móvil/PC"
              >
                <QrCode className="w-4 h-4" />
              </button>

              <a
                id="link-test-obs-tab"
                href={obsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg transition"
                title="Abrir vista de OBS en otra pestaña para probar"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Microphone Picker */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="mic-select"
              className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5"
            >
              <Mic className="w-3.5 h-3.5 text-emerald-400" />
              <span>¿Qué micrófono quieres usar?</span>
            </label>
            <button
              id="btn-refresh-devices"
              onClick={refreshDevices}
              className="text-[11px] text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Actualizar lista</span>
            </button>
          </div>

          <div className="relative">
            <select
              id="mic-select"
              value={settings.deviceId}
              onChange={(e) => {
                updateSetting('deviceId', e.target.value);
                if (isCapturing) {
                  // restart with new mic
                  setTimeout(() => startCapture(), 100);
                }
              }}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white appearance-none focus:outline-hidden focus:border-emerald-500 transition"
            >
              {devices.length === 0 ? (
                <option value="">Micrófono predeterminado del sistema</option>
              ) : (
                devices.map((dev) => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.label || `Micrófono (${dev.deviceId.slice(0, 8)}...)`}
                  </option>
                ))
              )}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400">
              <Sliders className="w-3.5 h-3.5" />
            </div>
          </div>

          {permissionState === 'denied' && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>
                El navegador no tiene permiso para acceder al micrófono. Concede el permiso en la barra de direcciones de tu navegador para continuar.
              </p>
            </div>
          )}
        </div>

        {/* Live VU Meter */}
        <div className="p-3.5 bg-zinc-950/60 border border-zinc-800/80 rounded-xl space-y-2">
          <AudioMeter
            level={volumeLevel}
            isMuted={isMuted}
            label={isCapturing ? 'Nivel del micrófono en vivo' : 'Medidor (inicia la transmisión para calibrar)'}
          />

          {isCapturing && volumeLevel === 0 && !isMuted && (
            <p className="text-[11px] text-amber-400/90 text-center">
              Habla hacia tu micrófono para verificar la señal.
            </p>
          )}
        </div>

        {/* Master Controls: Big Transmit Button + Mute Button */}
        <div className="flex items-center gap-2.5 pt-1">
          <button
            id="btn-toggle-broadcast"
            onClick={handleToggleBroadcast}
            className={`flex-1 flex items-center justify-center gap-2.5 py-4 px-6 rounded-2xl font-bold text-sm tracking-wide transition shadow-lg ${
              isCapturing
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/50 active:scale-[0.99]'
                : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-emerald-950/50 active:scale-[0.99]'
            }`}
          >
            {isCapturing ? (
              <>
                <Radio className="w-5 h-5 animate-pulse text-white" />
                <span>DETENER TRANSMISIÓN</span>
              </>
            ) : (
              <>
                <Zap className="w-5 h-5 fill-current" />
                <span>TRANSMITIR AUDIO AL OBS</span>
              </>
            )}
          </button>

          {isCapturing && (
            <button
              id="btn-toggle-mute"
              onClick={toggleMute}
              className={`p-4 rounded-2xl font-semibold transition border ${
                isMuted
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 hover:bg-rose-500/30'
                  : 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700'
              }`}
              title={isMuted ? 'Desmutear micrófono' : 'Mutear micrófono'}
              aria-label={isMuted ? 'Desmutear' : 'Mutear'}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}
        </div>

        {/* Errors display if any */}
        {(audioError || rtcError) && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300">
            {audioError || rtcError}
          </div>
        )}

        {/* Audio Adjustments Accordion */}
        <div className="border-t border-zinc-800/80 pt-3">
          <button
            id="btn-toggle-advanced-settings"
            onClick={() => setShowSettings(!showSettings)}
            className="w-full flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200 py-1"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Settings2 className="w-3.5 h-3.5" />
              <span>Ajustes de Calidad y Filtros</span>
            </span>
            <span className="text-[11px] text-emerald-400 font-mono">
              {showSettings ? 'Ocultar ▲' : 'Mostrar ▼'}
            </span>
          </button>

          {showSettings && (
            <div className="mt-3 p-3.5 bg-zinc-950/80 border border-zinc-800 rounded-xl space-y-3.5 text-xs text-zinc-300">
              {/* Gain Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-medium">
                  <span className="flex items-center gap-1">
                    <Volume2 className="w-3 h-3 text-zinc-400" />
                    Ganancia de Software (Boost):
                  </span>
                  <span className="font-mono text-emerald-400">
                    {Math.round(settings.gain * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="2.0"
                  step="0.05"
                  value={settings.gain}
                  onChange={(e) => updateSetting('gain', parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.noiseSuppression}
                    onChange={(e) => updateSetting('noiseSuppression', e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Supresión de Ruido</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.echoCancellation}
                    onChange={(e) => updateSetting('echoCancellation', e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Cancelación de Eco</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.autoGainControl}
                    onChange={(e) => updateSetting('autoGainControl', e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Control Automático (AGC)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={testLocally}
                    onChange={(e) => setTestLocally(e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                  <span className="flex items-center gap-1">
                    <Headphones className="w-3 h-3 text-zinc-400" />
                    <span>Retorno Local (Auriculares)</span>
                  </span>
                </label>
              </div>

              {testLocally && (
                <p className="text-[10px] text-amber-400/90 italic">
                  * Advertencia: Usa auriculares para el retorno local, de lo contrario el altavoz creará acople/eco.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer Info & Switch */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-2 text-xs text-zinc-500">
        <span>Opus 48kHz • Baja Latencia WebRTC</span>
        <button
          id="btn-switch-to-receiver-footer"
          onClick={onSwitchToReceiver}
          className="text-zinc-400 hover:text-emerald-400 transition underline underline-offset-2"
        >
          ¿Quieres ver la vista receptora de OBS? Clic aquí
        </button>
      </div>

      {/* Modals */}
      <QRCodeModal
        url={obsUrl}
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
      />

      <ObsInstructionsModal
        isOpen={showInstructions}
        onClose={() => setShowInstructions(false)}
        obsUrl={obsUrl}
      />
    </div>
  );
}

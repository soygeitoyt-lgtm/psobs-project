import { useEffect, useRef, useCallback, useState } from 'react';
import { Peer, MediaConnection, DataConnection } from 'peerjs';
import { AppRole, ConnectionStatus } from '../types';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Relay TURN: imprescindible con datos móviles o NAT estricto.
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

interface UseWebRTCOptions {
  room: string;
  role: AppRole;
  localStream: MediaStream | null;
  deviceName?: string;
  isMuted?: boolean;
}

const CALL_STALE_MS = 8000; // si una llamada no conecta en este tiempo, se descarta y se reintenta

function isCallConnected(call: MediaConnection | null): boolean {
  if (!call) return false;
  const pc = call.peerConnection;
  if (!pc) return false;
  const s = pc.connectionState;
  const ice = pc.iceConnectionState;
  return s === 'connected' || ice === 'connected' || ice === 'completed';
}

export function useWebRTC({
  room,
  role,
  localStream,
  deviceName,
  isMuted,
}: UseWebRTCOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectedPeersCount, setConnectedPeersCount] = useState(0);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pingLatency, setPingLatency] = useState<number | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const mediaCallRef = useRef<MediaConnection | null>(null);
  const dataConnRef = useRef<DataConnection | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const isMutedRef = useRef<boolean>(!!isMuted);
  const isConnectingRef = useRef<boolean>(false);
  const lastAttemptRef = useRef<number>(0);
  const reinitTimerRef = useRef<number | null>(null);

  const sanitizedRoom = room.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'default';
  // ID del receptor derivada de la sala (compatible con enlaces existentes).
  const receiverPeerId = `psobs-recv-${sanitizedRoom}`;

  // Keep localStreamRef synced
  useEffect(() => {
    localStreamRef.current = localStream;

    // Reemplazar pista de audio en una llamada activa sin cortar la conexión
    const call = mediaCallRef.current;
    if (call && call.peerConnection) {
      const pc = call.peerConnection;
      const senders = pc.getSenders();
      const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');
      const newTrack = localStream?.getAudioTracks()[0];
      if (audioSender && newTrack) {
        audioSender.replaceTrack(newTrack).catch((err) => {
          console.warn('Error reemplazando pista en WebRTC:', err);
        });
      } else if (!audioSender && newTrack && localStream) {
        pc.addTrack(newTrack, localStream);
      }
    }
  }, [localStream]);

  // Mantener estado de mute en el canal de datos
  useEffect(() => {
    isMutedRef.current = !!isMuted;
    if (dataConnRef.current && dataConnRef.current.open) {
      try {
        dataConnRef.current.send({ type: 'mute-status', isMuted: !!isMuted });
      } catch {
        // ignore
      }
    }
  }, [isMuted]);

  const closeCurrentCall = () => {
    const call = mediaCallRef.current;
    mediaCallRef.current = null;
    if (call) {
      try {
        call.close();
      } catch {}
    }
  };

  const ensureDataConnection = (peer: Peer) => {
    if (dataConnRef.current && dataConnRef.current.open) {
      return;
    }
    try {
      const conn = peer.connect(receiverPeerId, { reliable: true });
      dataConnRef.current = conn;
      conn.on('open', () => {
        try {
          conn.send({ type: 'mute-status', isMuted: isMutedRef.current });
        } catch {}
      });
      conn.on('data', (raw: unknown) => {
        const data = raw as { type?: string; timestamp?: number };
        if (data && data.type === 'pong' && data.timestamp) {
          setPingLatency(Math.round(performance.now() - data.timestamp));
        }
      });
      conn.on('close', () => {
        if (dataConnRef.current === conn) dataConnRef.current = null;
      });
      conn.on('error', () => {
        if (dataConnRef.current === conn) dataConnRef.current = null;
      });
    } catch {
      // el canal de datos no aborta el audio
    }
  };

  // Sender: establece llamada de audio hacia el receptor OBS
  const callReceiver = useCallback(() => {
    const peer = peerRef.current;
    if (!peer || peer.destroyed) return;
    const currentStream = localStreamRef.current;
    if (!currentStream) return;

    // Ya conectado: no duplicar
    if (isCallConnected(mediaCallRef.current)) return;

    // Un intento en curso reciente: esperar
    if (isConnectingRef.current && Date.now() - lastAttemptRef.current < 6000) return;

    // Socket PeerJS caído: intentar recuperarlo antes de llamar
    if (peer.disconnected) {
      try {
        peer.reconnect();
      } catch {}
    }

    // Descartar llamada previa muerta o estancada
    closeCurrentCall();

    isConnectingRef.current = true;
    lastAttemptRef.current = Date.now();
    setStatus((prev) => (prev === 'connected' ? prev : 'connecting-rtc'));
    setErrorMessage(null);

    try {
      const call = peer.call(receiverPeerId, currentStream, {
        metadata: { deviceName: deviceName || 'Micrófono Móvil' },
      });
      mediaCallRef.current = call;

      call.on('close', () => {
        isConnectingRef.current = false;
        if (mediaCallRef.current === call) mediaCallRef.current = null;
        setConnectedPeersCount(0);
        setStatus('waiting-peer');
      });

      call.on('error', (err) => {
        console.warn('Media call error:', err);
        isConnectingRef.current = false;
        if (mediaCallRef.current === call) mediaCallRef.current = null;
        setStatus('waiting-peer');
      });

      const handleStateChange = () => {
        const pc = call.peerConnection;
        if (!pc) return;
        const state = pc.connectionState;
        const ice = pc.iceConnectionState;
        if (state === 'connected' || ice === 'connected' || ice === 'completed') {
          isConnectingRef.current = false;
          setStatus('connected');
          setConnectedPeersCount(1);
          setErrorMessage(null);
        } else if (state === 'failed' || state === 'closed' || ice === 'failed') {
          isConnectingRef.current = false;
          if (mediaCallRef.current === call) mediaCallRef.current = null;
          setConnectedPeersCount(0);
          setStatus('waiting-peer');
        }
        // 'disconnected' transitorio: no tumbar la llamada
      };

      const wireStateHandlers = () => {
        if (call.peerConnection) {
          call.peerConnection.onconnectionstatechange = handleStateChange;
          call.peerConnection.oniceconnectionstatechange = handleStateChange;
          return true;
        }
        return false;
      };

      if (!wireStateHandlers()) {
        setTimeout(wireStateHandlers, 150);
        setTimeout(wireStateHandlers, 600);
      }

      ensureDataConnection(peer);
    } catch (err) {
      isConnectingRef.current = false;
      setStatus('waiting-peer');
      console.warn('Error calling receiver:', err);
    }
  }, [receiverPeerId, deviceName]);

  // Inicializa el Peer (señalización en PeerJS Cloud)
  const initPeer = useCallback(() => {
    if (reinitTimerRef.current) {
      window.clearTimeout(reinitTimerRef.current);
      reinitTimerRef.current = null;
    }
    if (pingIntervalRef.current) {
      window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    closeCurrentCall();
    if (dataConnRef.current) {
      try {
        dataConnRef.current.close();
      } catch {}
      dataConnRef.current = null;
    }
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch {}
      peerRef.current = null;
    }

    isConnectingRef.current = false;
    setStatus('connecting-ws');
    setErrorMessage(null);

    const peerId =
      role === 'receiver'
        ? receiverPeerId
        : `obsmic-send-${sanitizedRoom}-${Math.random().toString(36).slice(2, 8)}`;

    const peer = new Peer(peerId, {
      config: { iceServers: ICE_SERVERS },
    });
    peerRef.current = peer;

    peer.on('open', () => {
      setStatus('waiting-peer');
      setErrorMessage(null);
      if (role === 'sender' && localStreamRef.current) {
        callReceiver();
      }
    });

    if (role === 'receiver') {
      peer.on('call', (incomingCall) => {
        incomingCall.answer();
        mediaCallRef.current = incomingCall;

        incomingCall.on('stream', (stream) => {
          setRemoteStream(stream);
          setStatus('connected');
          setConnectedPeersCount(1);
          setErrorMessage(null);
        });

        incomingCall.on('close', () => {
          if (mediaCallRef.current === incomingCall) mediaCallRef.current = null;
          setRemoteStream(null);
          setConnectedPeersCount(0);
          setStatus('waiting-peer');
        });

        incomingCall.on('error', (err) => {
          console.warn('Incoming call error:', err);
          if (mediaCallRef.current === incomingCall) mediaCallRef.current = null;
          setRemoteStream(null);
          setConnectedPeersCount(0);
          setStatus('waiting-peer');
        });

        const handleReceiverStateChange = () => {
          const pc = incomingCall.peerConnection;
          if (!pc) return;
          const state = pc.connectionState;
          const ice = pc.iceConnectionState;
          if (state === 'connected' || ice === 'connected' || ice === 'completed') {
            setStatus('connected');
            setConnectedPeersCount(1);
            setErrorMessage(null);
          } else if (state === 'failed' || state === 'closed' || ice === 'failed') {
            setStatus('waiting-peer');
            setConnectedPeersCount(0);
            setRemoteStream(null);
            if (mediaCallRef.current === incomingCall) mediaCallRef.current = null;
          }
        };

        const wireReceiverHandlers = () => {
          if (incomingCall.peerConnection) {
            incomingCall.peerConnection.onconnectionstatechange = handleReceiverStateChange;
            incomingCall.peerConnection.oniceconnectionstatechange = handleReceiverStateChange;
            return true;
          }
          return false;
        };
        if (!wireReceiverHandlers()) {
          setTimeout(wireReceiverHandlers, 150);
          setTimeout(wireReceiverHandlers, 600);
        }
      });

      peer.on('connection', (incomingConn) => {
        dataConnRef.current = incomingConn;
        incomingConn.on('data', (raw: unknown) => {
          const data = raw as { type?: string; isMuted?: boolean; timestamp?: number };
          if (!data) return;
          if (data.type === 'mute-status') {
            setRemoteMuted(!!data.isMuted);
          } else if (data.type === 'ping') {
            try {
              incomingConn.send({ type: 'pong', timestamp: data.timestamp });
            } catch {}
          }
        });
        incomingConn.on('close', () => {
          if (dataConnRef.current === incomingConn) dataConnRef.current = null;
        });
        incomingConn.on('error', () => {
          if (dataConnRef.current === incomingConn) dataConnRef.current = null;
        });
      });
    }

    peer.on('error', (err: { type?: string; message?: string }) => {
      if (err.type === 'peer-unavailable') {
        // El receptor aún no está registrado (OBS cerrado/abriendo):
        // limpiar la llamada y dejar que el watchdog reintente.
        isConnectingRef.current = false;
        closeCurrentCall();
        setStatus('waiting-peer');
      } else if (err.type === 'unavailable-id') {
        // La ID aún la tiene la instancia anterior (reload de OBS). Reintentar.
        setErrorMessage('Reconectando sala en el servidor...');
        setStatus('connecting-ws');
        reinitTimerRef.current = window.setTimeout(() => {
          initPeer();
        }, 2000);
      } else {
        console.warn('PeerJS notice:', err);
        if (err.message && !err.message.includes('Could not connect')) {
          setErrorMessage(err.message);
        }
      }
    });

    peer.on('disconnected', () => {
      setStatus('disconnected');
      try {
        peer.reconnect();
      } catch {}
    });

    // Ping periódico (solo emisor)
    if (role === 'sender') {
      pingIntervalRef.current = window.setInterval(() => {
        if (dataConnRef.current && dataConnRef.current.open) {
          try {
            dataConnRef.current.send({ type: 'ping', timestamp: performance.now() });
          } catch {}
        }
      }, 5000);
    }
  }, [role, receiverPeerId, sanitizedRoom, callReceiver]);

  // Watchdog emisor: recupera sockets caídos, descarta llamadas estancadas
  // y reintenta hasta conectar. Auto-repara todos los estados de bloqueo.
  useEffect(() => {
    if (role !== 'sender') return;
    const id = window.setInterval(() => {
      const peer = peerRef.current;
      if (!peer || peer.destroyed) return;
      if (!localStreamRef.current) return;

      // Recuperar el socket WebSocket si se cayó
      if (peer.disconnected) {
        try {
          peer.reconnect();
        } catch {}
      }

      // Ya conectado: no hacer nada
      if (isCallConnected(mediaCallRef.current)) return;

      // Intento estancado demasiado tiempo: descartar y reintentar
      if (isConnectingRef.current && Date.now() - lastAttemptRef.current > CALL_STALE_MS) {
        isConnectingRef.current = false;
        closeCurrentCall();
      }

      // Llamada vieja sin conectar nunca: descartar
      if (!isConnectingRef.current && mediaCallRef.current && !isCallConnected(mediaCallRef.current)) {
        closeCurrentCall();
      }

      callReceiver();
    }, 2000);
    return () => window.clearInterval(id);
  }, [role, callReceiver]);

  // Watchdog receptor: recuperar socket caído
  useEffect(() => {
    if (role !== 'receiver') return;
    const id = window.setInterval(() => {
      const peer = peerRef.current;
      if (!peer || peer.destroyed) return;
      if (peer.disconnected) {
        try {
          peer.reconnect();
        } catch {}
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [role]);

  // Cuando la pista de audio aparece en el emisor, intentar conectar
  useEffect(() => {
    if (role === 'sender' && localStream) {
      callReceiver();
    }
  }, [localStream, role, callReceiver]);

  // Inicialización y limpieza
  useEffect(() => {
    initPeer();

    const handleBeforeUnload = () => {
      try {
        peerRef.current?.destroy();
      } catch {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
      if (reinitTimerRef.current) window.clearTimeout(reinitTimerRef.current);
      closeCurrentCall();
      if (dataConnRef.current) {
        try {
          dataConnRef.current.close();
        } catch {}
      }
      try {
        peerRef.current?.destroy();
      } catch {}
      peerRef.current = null;
    };
  }, [initPeer]);

  const reconnect = useCallback(() => {
    initPeer();
  }, [initPeer]);

  // Aviso si WebRTC queda mucho tiempo sin poder conectar (NAT sin relay)
  useEffect(() => {
    if (role !== 'sender' || status !== 'connecting-rtc') return;
    const t = window.setTimeout(() => {
      setErrorMessage(
        'No se pudo completar la conexión con OBS. Si el celular está en datos móviles, usa la misma WiFi o un servidor TURN.'
      );
    }, 25000);
    return () => window.clearTimeout(t);
  }, [status, role]);

  return {
    status,
    remoteStream,
    connectedPeersCount,
    remoteMuted,
    errorMessage,
    pingLatency,
    reconnect,
  };
}
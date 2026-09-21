import { useState, useEffect, useRef, useCallback } from 'react';
import { Peer, MediaConnection, DataConnection } from 'peerjs';
import { AppRole, ConnectionStatus } from '../types';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Relay TURN: imprescindible cuando el celular usa datos móviles
  // o hay NAT estricto. Sin relay, STUN solo falla en esas redes.
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
  const retryIntervalRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const isMutedRef = useRef<boolean>(!!isMuted);
  const isConnectingRef = useRef<boolean>(false);

  const sanitizedRoom = room.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'default';
  // Token único por sala (en la URL) para que la ID del receptor no choque
  // con la de otros usuarios en PeerJS Cloud (IDs globales compartidas).
  const urlToken =
    new URLSearchParams(window.location.search)
      .get('token')
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '') || '';
  const receiverPeerId = `psobs-recv-${urlToken || sanitizedRoom}`;

  // Keep localStreamRef synced
  useEffect(() => {
    localStreamRef.current = localStream;

    // If active call exists, replace audio track seamlessly
    if (mediaCallRef.current && mediaCallRef.current.peerConnection) {
      const pc = mediaCallRef.current.peerConnection;
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

  // Keep mute status synced over data channel
  useEffect(() => {
    isMutedRef.current = !!isMuted;
    if (dataConnRef.current && dataConnRef.current.open) {
      try {
        dataConnRef.current.send({
          type: 'mute-status',
          isMuted: !!isMuted,
        });
      } catch {
        // ignore
      }
    }
  }, [isMuted]);

  // Sender: Establish call and data connection to OBS receiver
  const callReceiver = useCallback(() => {
    if (!peerRef.current || peerRef.current.destroyed || peerRef.current.disconnected) {
      return;
    }
    const currentStream = localStreamRef.current;
    if (!currentStream) {
      return;
    }

    // Guard: si ya hay una llamada en curso (conectando o conectada), no duplicar
    if (mediaCallRef.current) {
      const pc = mediaCallRef.current.peerConnection;
      if (pc) {
        const connState = pc.connectionState;
        const iceState = pc.iceConnectionState;
        if (
          connState === 'connected' ||
          connState === 'connecting' ||
          connState === 'new' ||
          iceState === 'connected' ||
          iceState === 'completed' ||
          iceState === 'checking'
        ) {
          // Ya hay una llamada activa o en proceso: no crear otra
          return;
        }
      }
    }

    if (isConnectingRef.current) {
      return;
    }

    // Cerrar una llamada previa muerta/fallida antes de crear la nueva
    if (mediaCallRef.current) {
      const oldCall = mediaCallRef.current;
      mediaCallRef.current = null;
      try {
        oldCall.close();
      } catch {}
    }

    try {
      isConnectingRef.current = true;
      setStatus((prev) => (prev === 'connected' ? 'connected' : 'connecting-rtc'));

      // 1. Audio Media Call
      const call = peerRef.current.call(receiverPeerId, currentStream, {
        metadata: {
          deviceName: deviceName || 'Micrófono Móvil',
        },
      });

      mediaCallRef.current = call;

      call.on('close', () => {
        isConnectingRef.current = false;
        // Solo limpiar la ref si esta llamada sigue siendo la actual
        if (mediaCallRef.current === call) {
          mediaCallRef.current = null;
        }
        setConnectedPeersCount(0);
        setStatus('waiting-peer');
      });

      call.on('error', (err) => {
        console.warn('Media call error:', err);
        isConnectingRef.current = false;
        if (mediaCallRef.current === call) {
          mediaCallRef.current = null;
        }
        setStatus('waiting-peer');
      });

      const handleStateChange = () => {
        const pc = call.peerConnection;
        if (!pc) return;
        const state = pc.connectionState;
        const iceState = pc.iceConnectionState;

        if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
          isConnectingRef.current = false;
          setStatus('connected');
          setConnectedPeersCount(1);
          setErrorMessage(null);
        } else if (state === 'failed' || state === 'closed' || iceState === 'failed') {
          // Solo fatal: cerramos y dejamos que el reintento haga su trabajo
          isConnectingRef.current = false;
          setStatus('waiting-peer');
          setConnectedPeersCount(0);
          if (mediaCallRef.current === call) {
            mediaCallRef.current = null;
          }
        }
        // 'disconnected' transitorio: NO tumbar la llamada (evita el loop reconectar-caer)
      };

      if (call.peerConnection) {
        call.peerConnection.onconnectionstatechange = handleStateChange;
        call.peerConnection.oniceconnectionstatechange = handleStateChange;
      } else {
        setTimeout(() => {
          if (call.peerConnection) {
            call.peerConnection.onconnectionstatechange = handleStateChange;
            call.peerConnection.oniceconnectionstatechange = handleStateChange;
          }
        }, 150);
      }

      // 2. Data Connection (independent channel for mute status & ping)
      if (!dataConnRef.current || !dataConnRef.current.open) {
        try {
          const conn = peerRef.current.connect(receiverPeerId, {
            reliable: true,
          });
          dataConnRef.current = conn;

          conn.on('open', () => {
            conn.send({
              type: 'mute-status',
              isMuted: isMutedRef.current,
            });
          });

          conn.on('data', (raw: unknown) => {
            const data = raw as { type?: string; timestamp?: number };
            if (data && data.type === 'pong' && data.timestamp) {
              setPingLatency(Math.round(performance.now() - data.timestamp));
            }
          });

          conn.on('close', () => {
            dataConnRef.current = null;
          });

          conn.on('error', () => {
            dataConnRef.current = null;
          });
        } catch {
          // data connection error does not abort audio
        }
      }
    } catch (err) {
      isConnectingRef.current = false;
      console.warn('Error calling receiver:', err);
    }
  }, [receiverPeerId, deviceName]);

  // Main Peer initialization
  const initPeer = useCallback(() => {
    // Cleanup existing intervals & connections
    if (retryIntervalRef.current) {
      clearInterval(retryIntervalRef.current);
      retryIntervalRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (mediaCallRef.current) {
      try {
        mediaCallRef.current.close();
      } catch {}
      mediaCallRef.current = null;
    }
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
      config: {
        iceServers: ICE_SERVERS,
      },
    });
    peerRef.current = peer;

    peer.on('open', (_id) => {
      setStatus('waiting-peer');
      setErrorMessage(null);

      if (role === 'sender' && localStreamRef.current) {
        callReceiver();
      }
    });

    // RECEIVER logic (OBS Browser Source)
    if (role === 'receiver') {
      peer.on('call', (incomingCall) => {
        // Answer incoming audio stream from phone
        incomingCall.answer();
        mediaCallRef.current = incomingCall;

        incomingCall.on('stream', (stream) => {
          setRemoteStream(stream);
          setStatus('connected');
          setConnectedPeersCount(1);
          setErrorMessage(null);
        });

        incomingCall.on('close', () => {
          if (mediaCallRef.current === incomingCall) {
            mediaCallRef.current = null;
          }
          setRemoteStream(null);
          setConnectedPeersCount(0);
          setStatus('waiting-peer');
        });

        incomingCall.on('error', (err) => {
          console.warn('Incoming call error:', err);
          if (mediaCallRef.current === incomingCall) {
            mediaCallRef.current = null;
          }
          setRemoteStream(null);
          setConnectedPeersCount(0);
          setStatus('waiting-peer');
        });

        const handleReceiverStateChange = () => {
          const pc = incomingCall.peerConnection;
          if (!pc) return;
          const state = pc.connectionState;
          const iceState = pc.iceConnectionState;

          if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
            setStatus('connected');
            setConnectedPeersCount(1);
            setErrorMessage(null);
          } else if (state === 'failed' || state === 'closed' || iceState === 'failed') {
            // Solo fatal
            setStatus('waiting-peer');
            setConnectedPeersCount(0);
            setRemoteStream(null);
            if (mediaCallRef.current === incomingCall) {
              mediaCallRef.current = null;
            }
          }
          // 'disconnected' transitorio: conservar la llamada y el audio
        };

        if (incomingCall.peerConnection) {
          incomingCall.peerConnection.onconnectionstatechange = handleReceiverStateChange;
          incomingCall.peerConnection.oniceconnectionstatechange = handleReceiverStateChange;
        } else {
          setTimeout(() => {
            if (incomingCall.peerConnection) {
              incomingCall.peerConnection.onconnectionstatechange = handleReceiverStateChange;
              incomingCall.peerConnection.oniceconnectionstatechange = handleReceiverStateChange;
            }
          }, 150);
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
            incomingConn.send({ type: 'pong', timestamp: data.timestamp });
          }
        });

        incomingConn.on('close', () => {
          dataConnRef.current = null;
        });
      });
    }

    // Handle Peer errors
    peer.on('error', (err: { type?: string; message?: string }) => {
      if (err.type === 'peer-unavailable') {
        // OBS source is not yet open on PC
        isConnectingRef.current = false;
        setStatus('waiting-peer');
      } else if (err.type === 'unavailable-id') {
        // If a previous instance of OBS held the ID during reload, wait and retry
        setErrorMessage('La sala se está conectando en el servidor... Reconectando...');
        setStatus('connecting-ws');
        setTimeout(() => {
          if (peerRef.current) {
            try {
              peerRef.current.destroy();
            } catch {}
            peerRef.current = null;
          }
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

    // Start intervals on sender
    if (role === 'sender') {
      // Periodic ping for latency display
      pingIntervalRef.current = window.setInterval(() => {
        if (dataConnRef.current && dataConnRef.current.open) {
          try {
            dataConnRef.current.send({
              type: 'ping',
              timestamp: performance.now(),
            });
          } catch {}
        }
      }, 5000);

      // Safe auto-retry: ONLY retry if there is NO active call or it's truly
      // failed/closed (not transient 'disconnected', that would cause a loop)
      retryIntervalRef.current = window.setInterval(() => {
        if (!localStreamRef.current || isConnectingRef.current) return;

        const activeCall = mediaCallRef.current;
        const callState = activeCall?.peerConnection?.connectionState;
        const needsRetry =
          !activeCall || callState === 'failed' || callState === 'closed';

        if (needsRetry) {
          callReceiver();
        }
      }, 3500);
    }
  }, [role, receiverPeerId, sanitizedRoom, callReceiver]);

  // When local stream becomes available on sender, trigger call if not connected
  useEffect(() => {
    if (role === 'sender' && localStream) {
      callReceiver();
    }
  }, [localStream, role, callReceiver]);

  // Init on mount or room change
  useEffect(() => {
    initPeer();

    const handleBeforeUnload = () => {
      try {
        if (peerRef.current) peerRef.current.destroy();
      } catch {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (retryIntervalRef.current) clearInterval(retryIntervalRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (mediaCallRef.current) {
        try {
          mediaCallRef.current.close();
        } catch {}
      }
      if (dataConnRef.current) {
        try {
          dataConnRef.current.close();
        } catch {}
      }
      if (peerRef.current) {
        try {
          peerRef.current.destroy();
        } catch {}
      }
    };
  }, [initPeer]);

  const reconnect = useCallback(() => {
    initPeer();
  }, [initPeer]);

  // Aviso si WebRTC queda atascado en connecting-rtc (posible bloqueo de NAT)
  useEffect(() => {
    if (role !== 'sender' || status !== 'connecting-rtc') return;
    const t = window.setTimeout(() => {
      setErrorMessage(
        'No se pudo completar la conexión directa (NAT). Si el celular está en datos móviles, conecta ambos a la misma WiFi o usa un servidor TURN.'
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

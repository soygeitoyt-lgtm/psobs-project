import { useState, useEffect, useRef, useCallback } from 'react';
import { Peer, MediaConnection, DataConnection } from 'peerjs';
import { AppRole, ConnectionStatus } from '../types';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
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

  const sanitizedRoom = room.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'default';
  const receiverPeerId = `obsmic-recv-${sanitizedRoom}`;

  // Keep localStreamRef synced
  useEffect(() => {
    localStreamRef.current = localStream;

    // Hot-replace track if audio stream changed during active call
    if (mediaCallRef.current && mediaCallRef.current.peerConnection) {
      const pc = mediaCallRef.current.peerConnection;
      const senders = pc.getSenders();
      const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');
      const newTrack = localStream?.getAudioTracks()[0];

      if (audioSender && newTrack) {
        audioSender.replaceTrack(newTrack).catch((err) => {
          console.warn('Error reemplazando pista de audio:', err);
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
      dataConnRef.current.send({
        type: 'mute-status',
        isMuted: !!isMuted,
      });
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

    // Close previous call if disconnected
    if (mediaCallRef.current) {
      try {
        mediaCallRef.current.close();
      } catch {
        // ignore
      }
      mediaCallRef.current = null;
    }

    try {
      setStatus('connecting-rtc');

      // 1. Audio Media Call
      const call = peerRef.current.call(receiverPeerId, currentStream, {
        metadata: {
          deviceName: deviceName || 'Micrófono Móvil',
        },
      });

      mediaCallRef.current = call;

      call.on('close', () => {
        setConnectedPeersCount(0);
        setStatus('waiting-peer');
        mediaCallRef.current = null;
      });

      call.on('error', (err) => {
        console.warn('Media call error:', err);
      });

      if (call.peerConnection) {
        call.peerConnection.onconnectionstatechange = () => {
          const state = call.peerConnection.connectionState;
          if (state === 'connected') {
            setStatus('connected');
            setConnectedPeersCount(1);
            setErrorMessage(null);
          } else if (state === 'disconnected' || state === 'failed') {
            setStatus('waiting-peer');
            setConnectedPeersCount(0);
          }
        };
      }

      // 2. Data Connection (for mute status, ping, etc.)
      if (dataConnRef.current) {
        try {
          dataConnRef.current.close();
        } catch {
          // ignore
        }
      }

      const conn = peerRef.current.connect(receiverPeerId, {
        reliable: true,
      });
      dataConnRef.current = conn;

      conn.on('open', () => {
        setStatus('connected');
        setConnectedPeersCount(1);
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
    } catch (err) {
      console.warn('Error calling receiver:', err);
    }
  }, [receiverPeerId, deviceName]);

  // Main Peer initialization
  const initPeer = useCallback(() => {
    // Cleanup existing peer
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

    setStatus('connecting-ws');
    setErrorMessage(null);

    const peerId =
      role === 'receiver'
        ? receiverPeerId
        : `obsmic-send-${sanitizedRoom}-${Math.random().toString(36).slice(2, 7)}`;

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

    // RECEIVER logic
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
          setRemoteStream(null);
          setConnectedPeersCount(0);
          setStatus('waiting-peer');
        });

        if (incomingCall.peerConnection) {
          incomingCall.peerConnection.onconnectionstatechange = () => {
            const state = incomingCall.peerConnection.connectionState;
            if (state === 'connected') {
              setStatus('connected');
            } else if (state === 'disconnected' || state === 'failed') {
              setStatus('waiting-peer');
              setConnectedPeersCount(0);
            }
          };
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

    // Handle errors (e.g., peer unavailable while receiver hasn't opened yet)
    peer.on('error', (err: { type?: string; message?: string }) => {
      if (err.type === 'peer-unavailable') {
        // Expected when OBS is not yet opened on PC
        setStatus('waiting-peer');
      } else if (err.type === 'unavailable-id') {
        // If an old receiver instance was hanging on this ID, retry after slight delay
        setErrorMessage('La sala ya tiene un receptor activo. Reconectando...');
        setTimeout(() => {
          if (peerRef.current && !peerRef.current.destroyed) {
            initPeer();
          }
        }, 3000);
      } else {
        console.warn('PeerJS error:', err);
        setErrorMessage(err.message || 'Error de conexión P2P');
      }
    });

    peer.on('disconnected', () => {
      setStatus('disconnected');
      try {
        peer.reconnect();
      } catch {}
    });

    // Start latency ping interval for sender
    if (role === 'sender') {
      pingIntervalRef.current = window.setInterval(() => {
        if (dataConnRef.current && dataConnRef.current.open) {
          dataConnRef.current.send({
            type: 'ping',
            timestamp: performance.now(),
          });
        }
      }, 5000);

      // Auto-retry calling OBS receiver periodically if capturing and not yet connected
      retryIntervalRef.current = window.setInterval(() => {
        if (
          localStreamRef.current &&
          (!mediaCallRef.current || !dataConnRef.current || !dataConnRef.current.open)
        ) {
          callReceiver();
        }
      }, 3000);
    }
  }, [role, receiverPeerId, sanitizedRoom, callReceiver]);

  // When local stream becomes available (or changes) on sender, trigger call
  useEffect(() => {
    if (role === 'sender' && localStream) {
      callReceiver();
    }
  }, [localStream, role, callReceiver]);

  // Init on mount or room change
  useEffect(() => {
    initPeer();

    return () => {
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

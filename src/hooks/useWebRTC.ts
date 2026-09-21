import { useState, useEffect, useRef, useCallback } from 'react';
import { AppRole, ConnectionStatus, SignalingMessage } from '../types';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 6,
};

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

  const wsRef = useRef<WebSocket | null>(null);
  const myClientIdRef = useRef<string>('');
  // Map of peerId -> RTCPeerConnection
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const localStreamRef = useRef<MediaStream | null>(localStream);

  // Keep localStreamRef synced
  useEffect(() => {
    localStreamRef.current = localStream;

    // If local stream changes (e.g. mic switch) while connections exist, update tracks
    peerConnectionsRef.current.forEach((pc) => {
      const senders = pc.getSenders();
      const audioSender = senders.find((s) => s.track && s.track.kind === 'audio');
      const newTrack = localStream?.getAudioTracks()[0];

      if (audioSender && newTrack) {
        audioSender.replaceTrack(newTrack).catch((err) => {
          console.warn('Error replacing audio track:', err);
        });
      } else if (!audioSender && newTrack && localStream) {
        pc.addTrack(newTrack, localStream);
      }
    });
  }, [localStream]);

  // Send Mute notification to peers
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'mute-status',
          room,
          isMuted: !!isMuted,
        })
      );
    }
  }, [isMuted, room]);

  // Helper to send message via WS
  const sendSignaling = useCallback((msg: SignalingMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Cleanup a specific peer connection
  const cleanupPeer = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    setConnectedPeersCount(peerConnectionsRef.current.size);
    if (peerConnectionsRef.current.size === 0 && role === 'receiver') {
      setRemoteStream(null);
      setStatus('waiting-peer');
    }
  }, [role]);

  // Create peer connection for a remote peer
  const getOrCreatePeerConnection = useCallback(
    (peerId: string): RTCPeerConnection => {
      let pc = peerConnectionsRef.current.get(peerId);
      if (pc && pc.signalingState !== 'closed') {
        return pc;
      }

      pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionsRef.current.set(peerId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignaling({
            type: 'ice-candidate',
            room,
            target: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          setStatus('connected');
          setErrorMessage(null);
        } else if (state === 'connecting') {
          setStatus('connecting-rtc');
        } else if (state === 'disconnected' || state === 'failed') {
          console.warn(`WebRTC state for ${peerId}: ${state}`);
          if (peerConnectionsRef.current.size <= 1) {
            setStatus('waiting-peer');
          }
        } else if (state === 'closed') {
          cleanupPeer(peerId);
        }
      };

      if (role === 'receiver') {
        pc.ontrack = (event) => {
          if (event.streams && event.streams[0]) {
            setRemoteStream(event.streams[0]);
            setStatus('connected');
          }
        };
      }

      // If sender, attach audio track
      if (role === 'sender' && localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc?.addTrack(track, localStreamRef.current!);
        });
      }

      return pc;
    },
    [role, room, sendSignaling, cleanupPeer]
  );

  // Initiate offer as sender towards receiver
  const initiateOffer = useCallback(
    async (receiverPeerId: string) => {
      try {
        setStatus('connecting-rtc');
        const pc = getOrCreatePeerConnection(receiverPeerId);

        const offer = await pc.createOffer({
          offerToReceiveAudio: false,
          offerToReceiveVideo: false,
        });
        await pc.setLocalDescription(offer);

        sendSignaling({
          type: 'offer',
          room,
          target: receiverPeerId,
          sdp: offer,
        });
      } catch (err: unknown) {
        console.error('Error creating WebRTC offer:', err);
        setErrorMessage('Error al iniciar conexión de audio.');
      }
    },
    [getOrCreatePeerConnection, room, sendSignaling]
  );

  // Connect WebSocket and setup signaling handlers
  const connectWebSocket = useCallback(() => {
    if (!room) return;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('connecting-ws');
    setErrorMessage(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('ws-ready');
      ws.send(
        JSON.stringify({
          type: 'join',
          room,
          role,
          deviceName: deviceName || (role === 'receiver' ? 'OBS Studio' : 'Micrófono Móvil'),
        })
      );

      // Start ping loop for keepalive & latency check
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const t0 = performance.now();
          ws.send(JSON.stringify({ type: 'ping', room }));
          (ws as unknown as { _lastPingTime: number })._lastPingTime = t0;
        }
      }, 15000);
    };

    ws.onmessage = async (event) => {
      try {
        const data: SignalingMessage = JSON.parse(event.data);

        if (data.type === 'pong') {
          const t0 = (ws as unknown as { _lastPingTime?: number })._lastPingTime;
          if (t0) {
            setPingLatency(Math.round(performance.now() - t0));
          }
          return;
        }

        if (data.type === 'joined') {
          myClientIdRef.current = data.clientId || '';
          setStatus('waiting-peer');
          return;
        }

        if (data.type === 'peer-joined') {
          const peerId = data.peerId;
          const peerRole = data.role;

          if (role === 'sender' && peerRole === 'receiver' && peerId) {
            // OBS joined our room! Let's send an offer
            await initiateOffer(peerId);
          }
          setConnectedPeersCount((c) => c + 1);
          return;
        }

        if (data.type === 'peer-left') {
          if (data.peerId) {
            cleanupPeer(data.peerId);
          }
          return;
        }

        if (data.type === 'offer' && role === 'receiver' && data.sdp && data.from) {
          const pc = getOrCreatePeerConnection(data.from);
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          sendSignaling({
            type: 'answer',
            room,
            target: data.from,
            sdp: answer,
          });
          return;
        }

        if (data.type === 'answer' && role === 'sender' && data.sdp && data.from) {
          const pc = peerConnectionsRef.current.get(data.from);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          }
          return;
        }

        if (data.type === 'ice-candidate' && data.candidate && data.from) {
          const pc = peerConnectionsRef.current.get(data.from);
          if (pc) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (iceErr) {
              console.warn('Error adding ICE candidate:', iceErr);
            }
          }
          return;
        }

        if (data.type === 'mute-status') {
          setRemoteMuted(!!data.isMuted);
          return;
        }

        if (data.type === 'error') {
          setErrorMessage(data.message || 'Error en el servidor de transmisión');
        }
      } catch (err: unknown) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    ws.onerror = (err) => {
      console.warn('WebSocket error:', err);
      setStatus('error');
      setErrorMessage('Conexión con el servidor interrumpida.');
    };

    ws.onclose = () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      setStatus('disconnected');
    };
  }, [room, role, deviceName, initiateOffer, getOrCreatePeerConnection, sendSignaling, cleanupPeer]);

  // Connect on room change or mount
  useEffect(() => {
    if (room) {
      connectWebSocket();
    }
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      peerConnectionsRef.current.forEach((pc) => pc.close());
      peerConnectionsRef.current.clear();
    };
  }, [connectWebSocket, room]);

  const reconnect = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    setRemoteStream(null);
    connectWebSocket();
  }, [connectWebSocket]);

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

export type AppRole = 'sender' | 'receiver';

export type ConnectionStatus =
  | 'idle'
  | 'connecting-ws'
  | 'ws-ready'
  | 'waiting-peer'
  | 'connecting-rtc'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

export interface AudioSettings {
  deviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  gain: number; // 0 to 2 (1 = 100%)
  stereo: boolean;
}

export interface SignalingMessage {
  type:
    | 'join'
    | 'joined'
    | 'peer-joined'
    | 'peer-left'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'mute-status'
    | 'volume'
    | 'ping'
    | 'pong'
    | 'error';
  room?: string;
  role?: AppRole;
  target?: string;
  from?: string;
  clientId?: string;
  peerId?: string;
  deviceName?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  isMuted?: boolean;
  level?: number;
  message?: string;
  timestamp?: number;
}

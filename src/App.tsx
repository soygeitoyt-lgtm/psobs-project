/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from 'react';
import { Radio, Mic, Monitor, Share2, Sparkles, Volume2 } from 'lucide-react';
import { AppRole } from './types';
import { SenderView } from './components/SenderView';
import { ReceiverView } from './components/ReceiverView';

function generateRandomRoomId(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `mic-${num}`;
}

export default function App() {
  const [role, setRole] = useState<AppRole>('sender');
  const [room, setRoom] = useState<string>('');
  const [isObsEmbedded, setIsObsEmbedded] = useState(false);

  // Initialize room and role from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    const urlRoom = params.get('room');

    if (urlRole === 'obs' || urlRole === 'receiver') {
      setRole('receiver');
      setIsObsEmbedded(true);
    } else {
      setRole('sender');
    }

    if (urlRoom) {
      setRoom(urlRoom.trim().toLowerCase());
    } else {
      const generated = generateRandomRoomId();
      setRoom(generated);
      // Sync URL
      const newParams = new URLSearchParams(window.location.search);
      newParams.set('room', generated);
      window.history.replaceState(null, '', `?${newParams.toString()}`);
    }
  }, []);

  const handleRoleChange = (newRole: AppRole) => {
    setRole(newRole);
    const params = new URLSearchParams(window.location.search);
    params.set('role', newRole === 'receiver' ? 'obs' : 'sender');
    if (room) params.set('room', room);
    window.history.replaceState(null, '', `?${params.toString()}`);
  };

  const handleRoomChange = (newRoom: string) => {
    setRoom(newRoom);
    const params = new URLSearchParams(window.location.search);
    params.set('room', newRoom);
    if (role === 'receiver') params.set('role', 'obs');
    window.history.replaceState(null, '', `?${params.toString()}`);
  };

  // If in OBS Browser Source mode with role=obs, we display minimal wrapper so it can be transparent
  const isPureObsSource = isObsEmbedded && role === 'receiver';

  return (
    <div
      id="app-root"
      className={`min-h-screen text-zinc-100 flex flex-col selection:bg-emerald-500 selection:text-zinc-950 ${
        isPureObsSource
          ? 'bg-transparent'
          : 'bg-zinc-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-black'
      }`}
    >
      {/* App Header (hidden if used as clean embedded OBS source) */}
      {!isPureObsSource && (
        <header className="border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-md sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Radio className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
                  <span>OBS Audio Streamer</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                    LIVE
                  </span>
                </h1>
                <p className="text-[11px] text-zinc-400">
                  Usa tu celular como micrófono inalámbrico para OBS Studio
                </p>
              </div>
            </div>

            {/* Role Switcher tabs */}
            <div className="flex items-center bg-zinc-900 border border-zinc-800 p-1 rounded-xl text-xs font-semibold">
              <button
                id="tab-role-sender"
                onClick={() => handleRoleChange('sender')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  role === 'sender'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Celular (Mic)</span>
              </button>
              <button
                id="tab-role-receiver"
                onClick={() => handleRoleChange('receiver')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
                  role === 'receiver'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>OBS (PC)</span>
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-center items-center py-4">
        {room ? (
          role === 'sender' ? (
            <SenderView
              room={room}
              onRoomChange={handleRoomChange}
              onSwitchToReceiver={() => handleRoleChange('receiver')}
            />
          ) : (
            <ReceiverView
              room={room}
              onRoomChange={handleRoomChange}
              onSwitchToSender={() => handleRoleChange('sender')}
            />
          )
        ) : (
          <div className="text-zinc-400 text-xs animate-pulse">Cargando sala...</div>
        )}
      </main>

      {/* Footer (hidden in OBS embedded view) */}
      {!isPureObsSource && (
        <footer className="border-t border-zinc-900 py-3 text-center text-xs text-zinc-500">
          <p>
            Transmisión de audio en tiempo real • WebRTC P2P + Opus Codec • Compatible con OBS Studio, Streamlabs y vMix
          </p>
        </footer>
      )}
    </div>
  );
}

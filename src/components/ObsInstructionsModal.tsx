import { X, ExternalLink, CheckCircle2, Sliders, Monitor, Volume2 } from 'lucide-react';

interface ObsInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  obsUrl: string;
}

export function ObsInstructionsModal({ isOpen, onClose, obsUrl }: ObsInstructionsModalProps) {
  if (!isOpen) return null;

  return (
    <div
      id="obs-instructions-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="obs-instructions-content"
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-lg w-full space-y-5 shadow-2xl relative max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          id="btn-close-instructions-modal"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
          aria-label="Cerrar modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold">
            <Monitor className="w-3.5 h-3.5" />
            <span>Guía de Conexión</span>
          </div>
          <h3 className="text-xl font-bold text-white tracking-tight">
            Cómo añadir tu micrófono a OBS Studio
          </h3>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Sigue estos sencillos pasos para recibir el audio de tu móvil en OBS sin cables ni software extra.
          </p>
        </div>

        <div className="space-y-3.5 text-xs text-zinc-300">
          {/* Step 1 */}
          <div className="flex gap-3 p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
              1
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-white">Añade una fuente de Navegador en OBS</p>
              <p className="text-zinc-400 leading-normal">
                En OBS Studio, ve al panel de <span className="text-zinc-200 font-semibold">Fuentes (Sources)</span>, haz clic en el botón <span className="text-zinc-200 font-semibold">+</span> y selecciona <span className="text-emerald-400 font-semibold">Navegador (Browser)</span>.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3 p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
              2
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-white">Pega la URL de la Sala</p>
              <p className="text-zinc-400 leading-normal">
                En las propiedades de la fuente de Navegador, pega este enlace en el campo <span className="text-zinc-200 font-semibold">URL</span>:
              </p>
              <div className="p-2 bg-black/80 rounded-lg border border-zinc-800 font-mono text-[11px] text-emerald-400 break-all select-all">
                {obsUrl}
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="flex gap-3 p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
              3
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-white">Configura el audio en OBS</p>
              <p className="text-zinc-400 leading-normal">
                Marca la casilla <span className="text-zinc-200 font-semibold">"Controlar audio mediante OBS"</span> para que aparezca en el <span className="text-emerald-400 font-semibold">Mezclador de Audio</span> de OBS con su fader de volumen y filtros.
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="flex gap-3 p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
              4
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-white">¿Quieres escucharte a ti mismo con auriculares?</p>
              <p className="text-zinc-400 leading-normal">
                En el <span className="text-zinc-200 font-semibold">Mezclador de Audio</span> de OBS, haz clic en los 3 puntos (o engranaje) ➔ <span className="text-zinc-200 font-semibold">Propiedades de audio avanzadas</span> ➔ en tu fuente de Navegador cambia a <span className="text-emerald-400 font-semibold">"Monitorización y emisión"</span>.
              </p>
            </div>
          </div>

          {/* Step 5 */}
          <div className="flex gap-3 p-3 bg-zinc-950/60 border border-zinc-800/80 rounded-xl">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
              5
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-white">Dimensiones recomendadas</p>
              <p className="text-zinc-400 leading-normal">
                Si deseas usar el widget visual en pantalla, ajusta <span className="text-zinc-200 font-semibold">Ancho: 400</span> y <span className="text-zinc-200 font-semibold">Alto: 120</span>. Si solo quieres el audio invisible, usa el modo "Invisible (Audio Puro)" o colócala al fondo.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button
            id="btn-got-it-instructions"
            onClick={onClose}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold text-xs transition shadow-lg shadow-emerald-950/50"
          >
            Entendido, volver
          </button>
        </div>
      </div>
    </div>
  );
}

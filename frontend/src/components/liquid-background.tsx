import React from "react";

export function LiquidBackground() {
  return (
    <div className="fixed inset-0 -z-50 overflow-hidden pointer-events-none select-none w-screen h-screen">
      {/* Dynamic Background Base */}
      <div
        className="absolute inset-0 transition-colors duration-700 ease-in-out"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, var(--bg-radial-start, oklch(0.99 0.003 240)), var(--bg-radial-end, oklch(0.96 0.008 240)))",
        }}
      />

      {/* Light & Dark theme variable support for base */}
      <style>{`
        :root {
          --bg-radial-start: oklch(0.99 0.003 240);
          --bg-radial-end: oklch(0.96 0.008 240);
        }
        .dark {
          --bg-radial-start: oklch(0.12 0.03 250);
          --bg-radial-end: oklch(0.06 0.03 260);
        }
      `}</style>

      {/* Morphing Liquid Blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] md:w-[45vw] md:h-[45vw] rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/15 blur-[80px] md:blur-[120px] animate-liquid-1" />
      <div className="absolute top-[30%] right-[-10%] w-[65vw] h-[65vw] md:w-[50vw] md:h-[50vw] rounded-full bg-gradient-to-br from-emerald-500/15 to-teal-500/20 blur-[90px] md:blur-[130px] animate-liquid-2" />
      <div className="absolute bottom-[-10%] left-[10%] w-[55vw] h-[55vw] md:w-[40vw] md:h-[40vw] rounded-full bg-gradient-to-br from-pink-500/15 to-rose-500/20 blur-[80px] md:blur-[120px] animate-liquid-3" />
      <div className="absolute top-[20%] left-[25%] w-[40vw] h-[40vw] md:w-[30vw] md:h-[30vw] rounded-full bg-gradient-to-br from-amber-500/10 to-orange-500/15 blur-[70px] md:blur-[100px] animate-liquid-4" />
    </div>
  );
}

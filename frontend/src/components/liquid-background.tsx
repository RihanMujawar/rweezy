import React from "react";
import { motion } from "framer-motion";

export function LiquidBackground() {
  return (
    <div className="fixed inset-0 -z-50 overflow-hidden pointer-events-none select-none w-screen h-screen bg-background">
      {/* Dynamic Background Base */}
      <div
        className="absolute inset-0 transition-colors duration-1000 ease-in-out"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, var(--bg-radial-start, oklch(0.99 0.003 240)), var(--bg-radial-end, oklch(0.96 0.008 240)))",
        }}
      />

      <style>{`
        :root {
          --bg-radial-start: oklch(0.99 0.01 240);
          --bg-radial-end: oklch(0.96 0.02 240);
        }
        .dark {
          --bg-radial-start: oklch(0.12 0.03 250);
          --bg-radial-end: oklch(0.06 0.03 260);
        }
      `}</style>

      {/* High-Fidelity Morphing Blobs with Framer Motion */}
      <motion.div
        animate={{
          x: [0, 100, -50, 0],
          y: [0, -50, 100, 0],
          scale: [1, 1.2, 0.9, 1],
          rotate: [0, 90, 180, 360],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute top-[-10%] left-[-10%] w-[70vw] h-[70vw] rounded-full bg-gradient-to-br from-indigo-500/25 to-purple-500/20 blur-[100px] md:blur-[150px]"
      />

      <motion.div
        animate={{
          x: [0, -120, 80, 0],
          y: [0, 100, -120, 0],
          scale: [1, 1.3, 0.8, 1],
          rotate: [0, -120, 120, 0],
        }}
        transition={{
          duration: 30,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute top-[20%] right-[-15%] w-[75vw] h-[75vw] rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/25 blur-[120px] md:blur-[180px]"
      />

      <motion.div
        animate={{
          x: [0, 80, -100, 0],
          y: [0, -120, 50, 0],
          scale: [1, 0.8, 1.2, 1],
        }}
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute bottom-[-15%] left-[5%] w-[65vw] h-[65vw] rounded-full bg-gradient-to-br from-pink-500/20 to-rose-500/25 blur-[100px] md:blur-[150px]"
      />

      <motion.div
        animate={{
          scale: [1, 1.5, 1],
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="absolute top-[40%] left-[30%] w-[40vw] h-[40vw] rounded-full bg-gradient-to-br from-amber-500/15 to-orange-500/20 blur-[90px] md:blur-[130px]"
      />

      {/* Noise Texture Overlay for Premium Feel */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}

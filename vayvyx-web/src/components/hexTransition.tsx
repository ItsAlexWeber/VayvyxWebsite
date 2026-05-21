import { AnimatePresence, motion } from "motion/react";

type HexTransitionProps = {
  isActive: boolean;
};

const panels = [
  { id: "top", x: 0, y: -118, rotate: 0, origin: "50% 100%" },
  { id: "upper-right", x: 104, y: -60, rotate: 60, origin: "0% 100%" },
  { id: "lower-right", x: 104, y: 60, rotate: 120, origin: "0% 0%" },
  { id: "bottom", x: 0, y: 118, rotate: 180, origin: "50% 0%" },
  { id: "lower-left", x: -104, y: 60, rotate: 240, origin: "100% 0%" },
  { id: "upper-left", x: -104, y: -60, rotate: 300, origin: "100% 100%" },
];

export function HexTransition({ isActive }: HexTransitionProps) {
  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="hex-transition"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.5,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <motion.div
            className="transition-screen-mask"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0, 0.18, 0.98, 1] }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 1.65,
              times: [0, 0.46, 0.68, 0.88, 1],
              ease: [0.16, 1, 0.3, 1],
            }}
          />

          <motion.div
            className="hex-cover"
            initial={{
              scale: 0.08,
              opacity: 0,
              rotate: -8,
            }}
            animate={{
              scale: [0.08, 0.85, 2.9, 15],
              opacity: [0, 0.58, 0.72, 0.82],
              rotate: [-8, 0, 2, 4],
            }}
            exit={{
              opacity: 0,
              scale: 16,
            }}
            transition={{
              duration: 1.62,
              times: [0, 0.38, 0.68, 1],
              ease: [0.16, 1, 0.3, 1],
            }}
          />

          <motion.div
            className="hex-ring"
            initial={{
              scale: 0.18,
              opacity: 0,
              rotate: -10,
            }}
            animate={{
              scale: [0.18, 0.95, 1.08, 1.18],
              opacity: [0, 0.58, 0.34, 0],
              rotate: [-10, 0, 2, 4],
            }}
            transition={{
              duration: 1.28,
              times: [0, 0.45, 0.72, 1],
              ease: [0.16, 1, 0.3, 1],
            }}
          />

          <div className="hex-fold-stage">
            {panels.map((panel, index) => (
              <motion.div
                key={panel.id}
                className="hex-fold-panel"
                style={{ transformOrigin: panel.origin }}
                initial={{
                  x: 0,
                  y: 0,
                  rotate: panel.rotate,
                  rotateX: 0,
                  scale: 0.18,
                  opacity: 0,
                  filter: "blur(3px)",
                }}
                animate={{
                  x: [0, panel.x * 0.22, panel.x],
                  y: [0, panel.y * 0.22, panel.y],
                  rotate: [panel.rotate, panel.rotate + 1, panel.rotate],
                  rotateX: [0, 24, 44],
                  scale: [0.18, 0.82, 1],
                  opacity: [0, 0.5, 0.1],
                  filter: ["blur(3px)", "blur(0px)", "blur(2px)"],
                }}
                transition={{
                  duration: 1.18,
                  delay: 0.14 + index * 0.035,
                  times: [0, 0.5, 1],
                  ease: [0.16, 1, 0.3, 1],
                }}
              />
            ))}
          </div>

          <motion.div
            className="transition-logo"
            initial={{
              opacity: 0,
              scale: 0.86,
              y: 6,
              filter: "blur(10px)",
            }}
            animate={{
              opacity: [0, 0.78, 0.78, 0],
              scale: [0.86, 1, 1.01, 0.98],
              y: [6, 0, 0, -3],
              filter: [
                "blur(10px)",
                "blur(0px)",
                "blur(0px)",
                "blur(6px)",
              ],
            }}
            transition={{
              duration: 1.28,
              delay: 0.38,
              times: [0, 0.3, 0.76, 1],
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <span className="transition-logo-mark">
              <img src="/vayvyx-logo.png" alt="" />
            </span>
            <span className="transition-logo-text">Vayvyx</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
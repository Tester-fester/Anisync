import React from 'react';
import { motion } from 'motion/react';

export function AnisyncLogo({ className }: { className?: string }) {
  return (
    <motion.img
      src="/Logo.png"
      alt="Anisync Logo"
      className={className}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, type: 'spring', bounce: 0.4 }}
    />
  );
}

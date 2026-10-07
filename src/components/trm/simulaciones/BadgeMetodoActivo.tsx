'use client';

import React from 'react';
import { FORMULA_LABELS, NAVY } from './types';

interface Props {
  metodo: string;
  size?: 'sm' | 'md';
}

export function BadgeMetodoActivo({ metodo, size = 'md' }: Props) {
  const label = FORMULA_LABELS[metodo] ?? metodo;
  const fs = size === 'sm' ? 10 : 11;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: NAVY, color: 'white',
      padding: size === 'sm' ? '2px 7px' : '3px 10px',
      borderRadius: 20, fontSize: fs, fontWeight: 700, letterSpacing: '.02em',
    }}>
      ★ {label}
    </span>
  );
}
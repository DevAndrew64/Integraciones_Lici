'use client';

// src/components/licycolba/LicyChangePasswordModal.tsx

import React, { useState, useEffect, useRef } from 'react';

interface LicyChangePasswordModalProps {
  onClose: () => void;
  email: string;
}

interface FormState {
  actual: string;
  nueva: string;
  confirmar: string;
}

interface FormErrors {
  actual?: string;
  nueva?: string;
  confirmar?: string;
  general?: string;
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 10s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l14 14M8.5 8.6A2.5 2.5 0 0011.4 11.5M6.4 6.4C4.6 7.5 3 10 3 10s3 5 7 5c1.4 0 2.7-.5 3.8-1.2M10 5c4 0 7 5 7 5s-.8 1.4-2.2 2.7" />
    </svg>
  );
}

export default function LicyChangePasswordModal({ onClose, email }: LicyChangePasswordModalProps) {
  const [form, setForm] = useState<FormState>({ actual: '', nueva: '', confirmar: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [show, setShow] = useState({ actual: false, nueva: false, confirmar: false });
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!form.actual) errs.actual = 'Ingresa tu contraseña actual.';
    if (!form.nueva) {
      errs.nueva = 'Ingresa una nueva contraseña.';
    } else if (form.nueva.length < 8) {
      errs.nueva = 'Mínimo 8 caracteres.';
    } else if (form.nueva === form.actual) {
      errs.nueva = 'La nueva contraseña no puede ser igual a la actual.';
    }
    if (!form.confirmar) {
      errs.confirmar = 'Confirma la nueva contraseña.';
    } else if (form.nueva && form.confirmar !== form.nueva) {
      errs.confirmar = 'Las contraseñas no coinciden.';
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    try {
      const res = await fetch('/api/users/cambiar-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, actual: form.actual, nueva: form.nueva }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrors({ general: data.message ?? 'Contraseña actual incorrecta.' });
      } else {
        setSuccess(true);
        setTimeout(() => onClose(), 1800);
      }
    } catch {
      setErrors({ general: 'Error de conexión. Intenta de nuevo.' });
    } finally {
      setLoading(false);
    }
  }

  function handleChange(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((p) => ({ ...p, [field]: e.target.value }));
      setErrors((p) => ({ ...p, [field]: undefined, general: undefined }));
    };
  }

  return (
    <div className="lcpw-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lcpw-modal" role="dialog" aria-modal="true" aria-label="Cambiar contraseña">
        {/* Header */}
        <div className="lcpw-header">
          <div className="lcpw-header-icon">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="9" width="12" height="9" rx="2" />
              <path d="M7 9V6a3 3 0 016 0v3" />
              <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div>
            <h2 className="lcpw-title">Cambiar contraseña</h2>
            <p className="lcpw-subtitle">Actualiza tu contraseña de acceso.</p>
          </div>
          <button className="lcpw-close" onClick={onClose} aria-label="Cerrar">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Success */}
        {success ? (
          <div className="lcpw-success">
            <div className="lcpw-success-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M7 12l4 4 6-7" />
              </svg>
            </div>
            <p>¡Contraseña actualizada!</p>
          </div>
        ) : (
          <form className="lcpw-form" onSubmit={handleSubmit} noValidate>
            {errors.general && (
              <div className="lcpw-error-banner">
                <svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="8" opacity=".15"/><path d="M8 4.5v4M8 10.5v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                {errors.general}
              </div>
            )}

            {/* Campo contraseña actual */}
            <div className="lcpw-field">
              <label className="lcpw-label">Contraseña actual</label>
              <div className={`lcpw-input-wrap${errors.actual ? ' lcpw-input-wrap--error' : ''}`}>
                <input
                  ref={firstInputRef}
                  type={show.actual ? 'text' : 'password'}
                  className="lcpw-input"
                  placeholder="••••••••"
                  value={form.actual}
                  onChange={handleChange('actual')}
                  autoComplete="current-password"
                />
                <button type="button" className="lcpw-eye" onClick={() => setShow((p) => ({ ...p, actual: !p.actual }))}>
                  <EyeIcon open={show.actual} />
                </button>
              </div>
              {errors.actual && <span className="lcpw-field-error">{errors.actual}</span>}
            </div>

            {/* Nueva contraseña */}
            <div className="lcpw-field">
              <label className="lcpw-label">Nueva contraseña</label>
              <div className={`lcpw-input-wrap${errors.nueva ? ' lcpw-input-wrap--error' : ''}`}>
                <input
                  type={show.nueva ? 'text' : 'password'}
                  className="lcpw-input"
                  placeholder="Mínimo 8 caracteres"
                  value={form.nueva}
                  onChange={handleChange('nueva')}
                  autoComplete="new-password"
                />
                <button type="button" className="lcpw-eye" onClick={() => setShow((p) => ({ ...p, nueva: !p.nueva }))}>
                  <EyeIcon open={show.nueva} />
                </button>
              </div>
              {errors.nueva && <span className="lcpw-field-error">{errors.nueva}</span>}
              {form.nueva.length > 0 && (
                <div className="lcpw-strength">
                  {[1,2,3,4].map((i) => (
                    <div
                      key={i}
                      className={`lcpw-strength-bar${
                        form.nueva.length >= i * 3
                          ? form.nueva.length < 6 ? ' lcpw-strength-bar--weak'
                          : form.nueva.length < 10 ? ' lcpw-strength-bar--med'
                          : ' lcpw-strength-bar--strong'
                          : ''
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Confirmar */}
            <div className="lcpw-field">
              <label className="lcpw-label">Confirmar contraseña</label>
              <div className={`lcpw-input-wrap${errors.confirmar ? ' lcpw-input-wrap--error' : ''}`}>
                <input
                  type={show.confirmar ? 'text' : 'password'}
                  className="lcpw-input"
                  placeholder="Repite la nueva contraseña"
                  value={form.confirmar}
                  onChange={handleChange('confirmar')}
                  autoComplete="new-password"
                />
                <button type="button" className="lcpw-eye" onClick={() => setShow((p) => ({ ...p, confirmar: !p.confirmar }))}>
                  <EyeIcon open={show.confirmar} />
                </button>
              </div>
              {errors.confirmar && <span className="lcpw-field-error">{errors.confirmar}</span>}
            </div>

            {/* Acciones */}
            <div className="lcpw-actions">
              <button type="button" className="lcpw-btn-cancel" onClick={onClose} disabled={loading}>
                Cancelar
              </button>
              <button type="submit" className="lcpw-btn-save" disabled={loading}>
                {loading ? (
                  <>
                    <svg className="lcpw-spin" viewBox="0 0 20 20" fill="none">
                      <circle cx="10" cy="10" r="7" stroke="white" strokeWidth="2.5" strokeDasharray="32" strokeDashoffset="12" />
                    </svg>
                    Guardando…
                  </>
                ) : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
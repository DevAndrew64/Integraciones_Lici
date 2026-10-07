const PERFILES: Record<string, string> = {
  aseocolba:  'Aseocolba',
  vigicolba:  'Vigicolba',
  tempocolba: 'Tempocolba',
  transcolba: 'Transcolba',
};

export function normalizarPerfil(raw: string | null | undefined): string {
  if (!raw) return '';
  const key = raw.trim().toLowerCase();
  return PERFILES[key] ?? (raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase());
}

// Калибровка датчика влажности под наше железо.
// Бэкенд считает raw → 0..100 (ESP-32: DRY=2800, WET=1400 → map 0..100),
// но при реальном полном сливе сенсор достигает только ~15 в этой шкале.
// Растягиваем 0..MOISTURE_FULL_RAW_PCT → 0..100 для отображения и проверок.
export const MOISTURE_FULL_RAW_PCT = 15;
export const MOISTURE_DRAIN_THRESHOLD_PCT = 30; // в нормализованной шкале

export const normalizeMoisture = (
  raw: number | null | undefined
): number | null => {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
  const stretched = (raw / MOISTURE_FULL_RAW_PCT) * 100;
  return Math.max(0, Math.min(100, stretched));
};

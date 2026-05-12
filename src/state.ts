/**
 * Estado compartido entre los módulos. Lo mantenemos plano y reactivo
 * (mutado desde el panel, leído cada frame por escena/postpro).
 */

export type LandscapeId = 'mountains-lake' | 'desert' | 'coast-lighthouse';
export type LedShape = 'circle' | 'square';

export interface AppState {
  /** Velocidad del time-lapse. 1 = un ciclo completo en `dayDuration` segundos. */
  timeSpeed: number;
  /** Duración base de un ciclo a velocidad 1 (segundos). */
  dayDuration: number;
  /** Si true, ignora el reloj y usa `timeOverride`. */
  freezeTime: boolean;
  /** Hora normalizada [0,1] cuando está congelado. 0 = medianoche, 0.5 = mediodía. */
  timeOverride: number;
  /** Hora actual normalizada que la app actualiza cada frame. */
  timeOfDay: number;

  // Paisaje
  landscape: LandscapeId;
  landscapeBlend: number; // 0..2 para cross-fade entre los 3 (0=mountains, 1=desert, 2=coast)

  // Atmósfera
  rayleighStrength: number;
  mieStrength: number;
  mieG: number;
  turbidity: number;
  ozoneStrength: number;
  sunIntensity: number;
  sunSize: number;
  moonSize: number;
  starsDensity: number;
  starsBrightness: number;
  exposure: number;

  // Nubes
  cloudCoverage: number;
  cloudSpeed: number;
  cloudHeight: number;
  cloudDensity: number;
  cloudSharpness: number;

  // LED panel
  ledEnabled: boolean;
  ledCellPx: number;     // tamaño de celda en píxeles de pantalla
  ledGap: number;        // 0..0.5 fracción de la celda dedicada al gap
  ledShape: LedShape;
  ledBoost: number;      // gain de cada LED
  ledGridDarkness: number; // 0 = negro absoluto entre LEDs, 1 = sin oscurecer
  ledRoundness: number;  // suavizado del borde del LED

  // Post
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
}

export const state: AppState = {
  timeSpeed: 1.0,
  dayDuration: 45,
  freezeTime: false,
  timeOverride: 0.7, // golden hour
  timeOfDay: 0.7,

  landscape: 'mountains-lake',
  landscapeBlend: 0,

  rayleighStrength: 1.0,
  mieStrength: 1.0,
  mieG: 0.78,
  turbidity: 2.2,
  ozoneStrength: 1.0,
  sunIntensity: 24.0,
  sunSize: 4.5,
  moonSize: 1.0,
  starsDensity: 1.0,
  starsBrightness: 1.4,
  exposure: 1.0,

  cloudCoverage: 0.45,
  cloudSpeed: 0.04,
  cloudHeight: 0.18,
  cloudDensity: 0.85,
  cloudSharpness: 0.55,

  ledEnabled: true,
  ledCellPx: 10,
  ledGap: 0.16,
  ledShape: 'circle',
  ledBoost: 1.15,
  ledGridDarkness: 0.04,
  ledRoundness: 0.06,

  bloomStrength: 0.55,
  bloomRadius: 0.85,
  bloomThreshold: 0.55,
};

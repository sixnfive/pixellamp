import * as THREE from 'three';
import { state } from '../state';

/**
 * Controlador del ciclo diario.
 *
 *  timeOfDay ∈ [0,1):
 *    0.00  -> medianoche (sol -70°)
 *    0.25  -> amanecer  (sol  0°)
 *    0.50  -> mediodía  (sol +70°)
 *    0.75  -> atardecer (sol  0°)
 *
 * Calcula:
 *  - dirección del sol
 *  - color del sol (cálido al amanecer/atardecer, blanco al mediodía)
 *  - paleta ambiental para iluminación de paisajes
 *  - colores horizonte/cénit para reflejos de agua
 *
 * Pensado para que el paisaje y el agua queden coherentes con el cielo
 * del shader atmosférico, aunque cada uno se calcule por su cuenta.
 */

const COLORS = {
  // sun color at different elevations
  sunNoon: new THREE.Color(1.0, 0.97, 0.92),
  sunGolden: new THREE.Color(1.0, 0.62, 0.28),
  sunHorizon: new THREE.Color(1.0, 0.34, 0.12),

  // ambient palettes
  ambDayLow: new THREE.Color(0.32, 0.36, 0.42),
  ambDayHigh: new THREE.Color(0.58, 0.68, 0.85),
  ambSunsetLow: new THREE.Color(0.30, 0.18, 0.18),
  ambSunsetHigh: new THREE.Color(0.65, 0.42, 0.40),
  ambNightLow: new THREE.Color(0.018, 0.022, 0.035),
  ambNightHigh: new THREE.Color(0.05, 0.07, 0.13),

  // horizon / zenith for water reflection
  horizonDay: new THREE.Color(0.78, 0.85, 0.94),
  zenithDay: new THREE.Color(0.35, 0.55, 0.85),
  horizonSunset: new THREE.Color(1.0, 0.55, 0.22),
  zenithSunset: new THREE.Color(0.32, 0.22, 0.5),
  horizonNight: new THREE.Color(0.02, 0.03, 0.07),
  zenithNight: new THREE.Color(0.004, 0.008, 0.022),
};

const _tmpA = new THREE.Color();
const _tmpB = new THREE.Color();

function lerpColor(out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number) {
  out.r = THREE.MathUtils.lerp(a.r, b.r, t);
  out.g = THREE.MathUtils.lerp(a.g, b.g, t);
  out.b = THREE.MathUtils.lerp(a.b, b.b, t);
  return out;
}

export interface TimeFrame {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  sunY: number;
  sunColor: THREE.Color;
  ambientLow: THREE.Color;
  ambientHigh: THREE.Color;
  horizonColor: THREE.Color;
  zenithColor: THREE.Color;
}

/**
 * Camino celeste continuo en forma de "rueda" frente a la cámara.
 *
 * La cámara mira hacia -Z. La rueda gira en sentido horario sobre el eje
 * Z, así que el sol y la luna trazan un círculo (ligeramente oval por
 * `hStretch`) completamente C∞ — sin saltos ni cambios de azimut bruscos
 * en sunrise/sunset.
 *
 *   t = 0.25  sunrise  -> 9 en punto (izquierda, horizonte)
 *   t = 0.50  mediodía -> 12 en punto (arriba)
 *   t = 0.75  sunset   -> 3 en punto (derecha, horizonte)
 *   t = 0.00  midnight -> 6 en punto (abajo, oculto bajo el horizonte)
 *
 * La luna va en el mismo eje pero desfasada 12 h (t + 0.5), así que
 * cuando el sol se pone por la derecha la luna sale por la izquierda.
 *
 *   tiltDeg controla la "altura" angular del círculo (distancia desde
 *   la mirada de la cámara). hStretch ensancha el círculo horizontalmente
 *   para que el sol pase más tiempo cerca del horizonte (más rojo).
 */
function celestialDir(out: THREE.Vector3, t: number, tiltDeg: number, hStretch: number) {
  const angle = (t - 0.5) * Math.PI * 2;
  const tilt = THREE.MathUtils.degToRad(tiltDeg);
  const r = Math.sin(tilt);
  out.set(
    Math.sin(angle) * r * hStretch,
    Math.cos(angle) * r,
    -Math.cos(tilt),
  ).normalize();
  return out;
}

export class TimeOfDay {
  private sunDir = new THREE.Vector3(0, 1, 0);
  private moonDir = new THREE.Vector3(0, -1, 0);
  private sunColor = new THREE.Color();
  private ambientLow = new THREE.Color();
  private ambientHigh = new THREE.Color();
  private horizonColor = new THREE.Color();
  private zenithColor = new THREE.Color();
  private elapsed = 0;

  tick(dt: number): TimeFrame {
    if (!state.freezeTime) {
      this.elapsed += dt * state.timeSpeed;
      state.timeOfDay = (this.elapsed / state.dayDuration) % 1;
      if (state.timeOfDay < 0) state.timeOfDay += 1;
    } else {
      state.timeOfDay = state.timeOverride;
      this.elapsed = state.timeOverride * state.dayDuration;
    }

    const tt = state.timeOfDay;
    // Rueda celeste: el sol y la luna giran sobre el mismo círculo
    // virtual frente a la cámara, desfasados medio ciclo.
    celestialDir(this.sunDir, tt, 34, 1.35);
    celestialDir(this.moonDir, (tt + 0.5) % 1, 34, 1.35);
    const sunY = this.sunDir.y;

    // Sun color
    if (sunY > 0.25) {
      // Día pleno -> blanco
      const t = THREE.MathUtils.smoothstep(sunY, 0.25, 0.7);
      lerpColor(this.sunColor, COLORS.sunGolden, COLORS.sunNoon, t);
    } else if (sunY > 0.0) {
      // Golden hour
      const t = THREE.MathUtils.smoothstep(sunY, 0.0, 0.25);
      lerpColor(this.sunColor, COLORS.sunHorizon, COLORS.sunGolden, t);
    } else {
      // Justo en el horizonte / debajo
      const t = THREE.MathUtils.smoothstep(sunY, -0.1, 0.0);
      lerpColor(_tmpA, new THREE.Color(0, 0, 0), COLORS.sunHorizon, t);
      this.sunColor.copy(_tmpA);
    }

    // Ambient palette: noche -> sunset -> día
    if (sunY > 0.18) {
      const t = THREE.MathUtils.smoothstep(sunY, 0.18, 0.5);
      lerpColor(this.ambientLow, COLORS.ambSunsetLow, COLORS.ambDayLow, t);
      lerpColor(this.ambientHigh, COLORS.ambSunsetHigh, COLORS.ambDayHigh, t);
    } else if (sunY > -0.05) {
      const t = THREE.MathUtils.smoothstep(sunY, -0.05, 0.18);
      lerpColor(this.ambientLow, COLORS.ambNightLow, COLORS.ambSunsetLow, t);
      lerpColor(this.ambientHigh, COLORS.ambNightHigh, COLORS.ambSunsetHigh, t);
    } else {
      this.ambientLow.copy(COLORS.ambNightLow);
      this.ambientHigh.copy(COLORS.ambNightHigh);
    }

    // Horizon / zenith
    if (sunY > 0.18) {
      const t = THREE.MathUtils.smoothstep(sunY, 0.18, 0.5);
      lerpColor(this.horizonColor, COLORS.horizonSunset, COLORS.horizonDay, t);
      lerpColor(this.zenithColor, COLORS.zenithSunset, COLORS.zenithDay, t);
    } else if (sunY > -0.08) {
      const t = THREE.MathUtils.smoothstep(sunY, -0.08, 0.18);
      lerpColor(this.horizonColor, COLORS.horizonNight, COLORS.horizonSunset, t);
      lerpColor(this.zenithColor, COLORS.zenithNight, COLORS.zenithSunset, t);
    } else {
      this.horizonColor.copy(COLORS.horizonNight);
      this.zenithColor.copy(COLORS.zenithNight);
    }

    return {
      sunDir: this.sunDir,
      moonDir: this.moonDir,
      sunY,
      sunColor: this.sunColor,
      ambientLow: this.ambientLow,
      ambientHigh: this.ambientHigh,
      horizonColor: this.horizonColor,
      zenithColor: this.zenithColor,
    };
  }
}

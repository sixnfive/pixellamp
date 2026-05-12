import GUI from 'lil-gui';
import { state } from '../state';

/**
 * Panel de control (lil-gui).
 *
 * Organizado en 5 secciones para iterar como director de arte:
 *   · Tiempo
 *   · Paisaje
 *   · Atmósfera
 *   · Nubes
 *   · Panel LED
 *   · Post
 */

export function buildPanel(): GUI {
  const gui = new GUI({ title: 'PixelLamp', width: 320 });
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.top = '14px';
  gui.domElement.style.right = '14px';
  gui.domElement.style.maxHeight = 'calc(100vh - 28px)';
  gui.domElement.style.overflow = 'auto';

  // ── Tiempo ──
  const fTime = gui.addFolder('Tiempo');
  fTime.add(state, 'timeSpeed', 0, 20, 0.01).name('velocidad');
  fTime.add(state, 'dayDuration', 10, 600, 1).name('ciclo (s)');
  fTime.add(state, 'freezeTime').name('congelar');
  fTime.add(state, 'timeOverride', 0, 1, 0.001).name('hora 0–1');
  // Display de hora simulada
  const timeDisp = { hora: '—' };
  fTime.add(timeDisp, 'hora').name('hora actual').listen().disable();
  // Hooks visuales
  setInterval(() => {
    const h = state.timeOfDay * 24;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    timeDisp.hora = `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
  }, 100);

  // ── Paisaje ──
  const fLand = gui.addFolder('Paisaje');
  fLand
    .add(state, 'landscapeBlend', 0, 2, 0.001)
    .name('blend (mtn ▸ desert ▸ coast)');

  // ── Atmósfera ──
  const fAtm = gui.addFolder('Atmósfera');
  fAtm.add(state, 'rayleighStrength', 0, 3, 0.01).name('Rayleigh');
  fAtm.add(state, 'mieStrength', 0, 5, 0.01).name('Mie');
  fAtm.add(state, 'mieG', 0.0, 0.99, 0.001).name('Mie g (anis.)');
  fAtm.add(state, 'turbidity', 0.2, 8, 0.01).name('turbidez');
  fAtm.add(state, 'ozoneStrength', 0, 3, 0.01).name('ozono');
  fAtm.add(state, 'sunIntensity', 0, 60, 0.1).name('intens. sol');
  fAtm.add(state, 'sunSize', 0.3, 4, 0.01).name('tamaño sol');

  // ── Nubes ──
  const fCloud = gui.addFolder('Nubes');
  fCloud.add(state, 'cloudCoverage', 0, 1, 0.001).name('cobertura');
  fCloud.add(state, 'cloudSpeed', 0, 0.4, 0.001).name('velocidad');
  fCloud.add(state, 'cloudHeight', 0, 1, 0.001).name('altura');
  fCloud.add(state, 'cloudDensity', 0, 2, 0.001).name('densidad');
  fCloud.add(state, 'cloudSharpness', 0, 1, 0.001).name('definición');

  // ── Panel LED ──
  const fLed = gui.addFolder('Panel LED');
  fLed.add(state, 'ledEnabled').name('activar');
  fLed.add(state, 'ledCellPx', 2, 60, 1).name('celda (px)');
  fLed.add(state, 'ledGap', 0, 0.45, 0.001).name('gap');
  fLed.add(state, 'ledShape', ['circle', 'square']).name('forma');
  fLed.add(state, 'ledBoost', 0.5, 3, 0.001).name('boost');
  fLed.add(state, 'ledGridDarkness', 0, 1, 0.001).name('rejilla');
  fLed.add(state, 'ledRoundness', 0.005, 0.6, 0.001).name('suavizado borde');

  // ── Post ──
  const fPost = gui.addFolder('Post');
  fPost.add(state, 'exposure', 0.1, 3, 0.001).name('exposición');
  fPost.add(state, 'bloomStrength', 0, 2.5, 0.001).name('bloom intensidad');
  fPost.add(state, 'bloomRadius', 0, 1.5, 0.001).name('bloom radio');
  fPost.add(state, 'bloomThreshold', 0, 1.5, 0.001).name('bloom umbral');

  // Presets rápidos
  const presets = {
    'Atardecer LED': () => {
      state.timeOverride = 0.78;
      state.freezeTime = true;
      state.ledCellPx = 10;
      state.ledGap = 0.18;
      state.ledShape = 'circle';
      state.bloomStrength = 0.75;
      state.cloudCoverage = 0.45;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
    'Mediodía limpio': () => {
      state.timeOverride = 0.5;
      state.freezeTime = true;
      state.cloudCoverage = 0.2;
      state.bloomStrength = 0.4;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
    'Noche estrellada': () => {
      state.timeOverride = 0.02;
      state.freezeTime = true;
      state.cloudCoverage = 0.08;
      state.bloomStrength = 0.9;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
    'Loop normal': () => {
      state.freezeTime = false;
      state.timeSpeed = 1;
      state.dayDuration = 60;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
  };
  const fPreset = gui.addFolder('Presets');
  Object.keys(presets).forEach((k) => fPreset.add(presets, k as keyof typeof presets));

  fTime.open();
  fLed.open();
  return gui;
}

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { state } from '../state';

/**
 * Pase de pixelado LED.
 *
 *  - Cada celda muestrea el color del centro de su área en la imagen original
 *    (con un pequeño "box sample" opcional para promediar mejor).
 *  - Pinta una forma (círculo o cuadrado redondeado) brillante (`uBoost`)
 *    sobre un fondo de la rejilla oscurecido (`uGridDark`).
 *  - El bloom posterior añade el "halo" típico de un panel LED P0.9.
 */

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uCellPx;
uniform float uGap;
uniform float uShape;     // 0=circle 1=square
uniform float uBoost;
uniform float uGridDark;
uniform float uRoundness;
uniform float uEnabled;

vec3 sampleAvg(vec2 center, vec2 cellUv){
  // Suma de 4 muestras alrededor del centro para reducir aliasing
  vec2 off = cellUv * 0.18;
  vec3 c = vec3(0.0);
  c += texture2D(tDiffuse, center).rgb;
  c += texture2D(tDiffuse, center + vec2(off.x, 0.0)).rgb;
  c += texture2D(tDiffuse, center - vec2(off.x, 0.0)).rgb;
  c += texture2D(tDiffuse, center + vec2(0.0, off.y)).rgb;
  c += texture2D(tDiffuse, center - vec2(0.0, off.y)).rgb;
  return c / 5.0;
}

void main(){
  if(uEnabled < 0.5){
    gl_FragColor = texture2D(tDiffuse, vUv);
    return;
  }
  vec2 cell = vec2(uCellPx) / uResolution;
  vec2 idx = floor(vUv / cell);
  vec2 center = (idx + 0.5) * cell;
  vec3 col = sampleAvg(center, cell);

  vec2 local = (vUv - center) / cell; // [-0.5, 0.5]
  float r = 0.5 - uGap;
  float edge = max(uRoundness * r, 0.0015);

  float mask;
  if(uShape < 0.5){
    float d = length(local);
    mask = 1.0 - smoothstep(r - edge, r, d);
  } else {
    // Cuadrado con esquinas redondeadas suaves
    vec2 a = abs(local);
    float dSq = max(a.x, a.y);
    float dRd = length(max(a - vec2(r - edge * 1.4), 0.0));
    float d = mix(dSq, dRd, 0.35);
    mask = 1.0 - smoothstep(r - edge, r, d);
  }

  vec3 led = col * uBoost;
  vec3 grid = col * uGridDark;
  vec3 outCol = mix(grid, led, mask);
  gl_FragColor = vec4(outCol, 1.0);
}
`;

export function createPixelPass(width: number, height: number): ShaderPass {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(width, height) },
      uCellPx: { value: state.ledCellPx },
      uGap: { value: state.ledGap },
      uShape: { value: state.ledShape === 'circle' ? 0 : 1 },
      uBoost: { value: state.ledBoost },
      uGridDark: { value: state.ledGridDarkness },
      uRoundness: { value: state.ledRoundness },
      uEnabled: { value: state.ledEnabled ? 1 : 0 },
    },
    vertexShader,
    fragmentShader,
  });
  return pass;
}

export function updatePixelPass(pass: ShaderPass, width: number, height: number) {
  pass.uniforms.uResolution.value.set(width, height);
  pass.uniforms.uCellPx.value = state.ledCellPx;
  pass.uniforms.uGap.value = state.ledGap;
  pass.uniforms.uShape.value = state.ledShape === 'circle' ? 0 : 1;
  pass.uniforms.uBoost.value = state.ledBoost;
  pass.uniforms.uGridDark.value = state.ledGridDarkness;
  pass.uniforms.uRoundness.value = state.ledRoundness;
  pass.uniforms.uEnabled.value = state.ledEnabled ? 1 : 0;
}
